import asyncio
import logging
import os
import re
import httpx
from typing import Any, Dict, Optional, List, Tuple


log = logging.getLogger(__name__)

FLIPP_SEARCH_URL = "https://backflipp.wishabi.com/flipp/items/search"
OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"

# In-memory cache for Overpass store lookups
_overpass_cache: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}

_NON_GROCERY_KEYWORDS = {
    "dog", "cat", "pet", "puppy", "kitten", "feline", "canine",
    "bird", "fish tank", "aquarium", "reptile", "hamster",
}

_NON_GROCERY_STORES = {
    # Pet stores
    "pet valu", "petsmart", "petland", "global pet foods", "ren's pets",
    # Electronics / tech
    "best buy", "the source", "staples",
    # Auto / hardware / furniture
    "princess auto", "canadian tire", "partsource", "home hardware",
    "leon's", "the brick", "ikea",
    # Music / hobby / party
    "long & mcquade musical instruments", "party city",
    # Beauty
    "sephora",
    # Alcohol
    "lcbo",
    # Other non-grocery
    "best new product awards", "eb games canada", "mark's",
    "bath depot", "linen chest", "rona & rona +",
}

_NON_FOOD_KEYWORDS = {
    "laptop", "phone", "smartphone", "tablet", "iphone", "ipad",
    "macbook", "airpod", "headphone", "speaker", "cabinet",
    "amplifier", "charger", "funnels", "stool", "chair",
    "balloons", "washer fluid", "snow brush",
}


def _is_relevant_deal(item: dict, query: str) -> bool:
    """Check whether a Flipp result is actually relevant to the search query.

    Flipp returns fuzzy matches that are often wrong (e.g. "black pepper" returns
    "sweet peppers", "chicken broth" returns pet food). This filters by:
    1. Requiring all significant query words in the item name/description
    2. Excluding pet stores and pet-food keywords
    """
    item_name = (item.get("name") or "").lower()
    item_desc = (item.get("description") or "").lower()
    item_text = f"{item_name} {item_desc}"

    # Skip items with no name
    if not item_text.strip():
        return False

    # Exclude pet stores
    store = (item.get("merchant_name") or item.get("merchant") or "").lower()
    if store in _NON_GROCERY_STORES:
        return False

    # Reject non-food categories (Electronics, Furniture, etc.)
    l1 = (item.get("_L1") or "").strip()
    if l1 and l1 != "Food, Beverages & Tobacco":
        return False

    # Exclude items with pet-food keywords
    for kw in _NON_GROCERY_KEYWORDS:
        if kw in item_text:
            return False

    # Reject non-food items that Flipp miscategorizes
    for kw in _NON_FOOD_KEYWORDS:
        if kw in item_text:
            return False

    # All significant words from the query must appear in the item text.
    # Split query into words, ignore very short words (a, of, etc.)
    query_words = [w for w in query.lower().split() if len(w) > 2]
    if not query_words:
        return True

    return all(word in item_text for word in query_words)


# ---------------------------------------------------------------------------
# Weight / size extraction
# ---------------------------------------------------------------------------

# Matches patterns like: 2 lb, 675g, 500 mL, 1.5 L, 2lb, 570-675G, 1 kg, 12 oz
_WEIGHT_RE = re.compile(
    r'(\d+(?:\.\d+)?)\s*'          # number (with optional decimal)
    r'(?:-\s*(\d+(?:\.\d+)?)\s*)?'  # optional range end (e.g., 570-675)
    r'(kg|g|lb|lbs|oz|ml|l)\b',     # unit
    re.IGNORECASE,
)

# Count-based patterns: 6 pack, x12, 12 ct, 6 x 93 mL
_COUNT_RE = re.compile(
    r'(\d+)\s*(?:pack|pk|ct|count)\b'
    r'|x\s*(\d+)\b'
    r'|(\d+)\s*x\s*\d+',
    re.IGNORECASE,
)


def _extract_weight_from_text(*texts: str) -> Optional[Dict[str, str]]:
    """Extract weight/size info from one or more text strings using regex."""
    for text in texts:
        if not text:
            continue
        m = _WEIGHT_RE.search(text)
        if m:
            value = m.group(1)
            range_end = m.group(2)
            unit = m.group(3).lower()
            # Normalize units
            if unit == "lbs":
                unit = "lb"
            if unit == "ml":
                unit = "mL"
            if unit == "l" and float(value) < 50:
                unit = "L"
            elif unit == "l":
                unit = "mL"
            display = f"{value}-{range_end} {unit}" if range_end else f"{value} {unit}"
            return {"weight": display, "source": "text"}

        # Check for count patterns
        cm = _COUNT_RE.search(text)
        if cm:
            count = cm.group(1) or cm.group(2) or cm.group(3)
            if count:
                return {"weight": f"{count} pk", "source": "text"}
    return None


# ---------------------------------------------------------------------------
# Unit price calculation
# ---------------------------------------------------------------------------

# Conversion factors to grams (for solids) or mL (for liquids)
_TO_GRAMS = {"g": 1, "kg": 1000, "lb": 453.592, "lbs": 453.592, "oz": 28.3495}
_TO_ML = {"ml": 1, "mL": 1, "l": 1000, "L": 1000}

# Regex to detect per-weight pricing in post_price_text (e.g. "/lb", "lb", "/kg", "/100g", "/100 g")
_PER_WEIGHT_RE = re.compile(r'/?(100\s*g|lb|kg)\b', re.IGNORECASE)
# Regex to extract multi-buy quantity from pre_price_text (e.g. "2/", "3/")
_MULTI_BUY_RE = re.compile(r'^(\d+)\s*/')


def _parse_weight_grams(weight_str: Optional[str]) -> Optional[Tuple[float, str]]:
    """Parse a weight string like '675 g' or '570-675 g' into (grams, unit_type).

    For ranges, returns the midpoint. unit_type is 'weight' or 'volume'.
    Returns None if unparseable or count-based (e.g. '4 pk').
    """
    if not weight_str:
        return None
    m = _WEIGHT_RE.search(weight_str)
    if not m:
        return None
    value = float(m.group(1))
    range_end = m.group(2)
    unit = m.group(3).lower()

    if range_end:
        value = (value + float(range_end)) / 2

    if unit in _TO_GRAMS:
        grams = value * _TO_GRAMS[unit]
        # Sanity: reject absurd values (likely product codes misread as weight)
        if grams > 50000:  # > 50 kg is unrealistic for a single grocery item
            return None
        return grams, "weight"
    if unit in _TO_ML:
        ml = value * _TO_ML[unit]
        if ml > 50000:  # > 50 L
            return None
        return ml, "volume"
    return None


def _calc_unit_price(
    price: Optional[float],
    pre_price_text: str,
    post_price_text: str,
    weight_str: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Calculate unit price for a deal.

    Returns dict with unit_price, unit_price_display, comparison_unit or None.
    """
    if price is None or price <= 0:
        return None

    post_lower = post_price_text.lower()

    # Multi-buy: "2/" means 2 for $price, so per-item = price / qty
    multi_match = _MULTI_BUY_RE.match(pre_price_text)
    if multi_match:
        price = price / int(multi_match.group(1))

    # Case 1: Price is already per-weight (post has /lb, lb, /kg, /100g)
    per_weight_match = _PER_WEIGHT_RE.search(post_lower)
    if per_weight_match:
        per_unit = per_weight_match.group(1).lower().replace(" ", "")
        if per_unit == "lb":
            # Convert $/lb → $/100g
            price_per_100g = price / 453.592 * 100
            return {
                "unit_price": round(price_per_100g, 2),
                "unit_price_display": f"${price_per_100g:.2f}/100g",
                "comparison_unit": "100g",
            }
        elif per_unit == "kg":
            price_per_100g = price / 10
            return {
                "unit_price": round(price_per_100g, 2),
                "unit_price_display": f"${price_per_100g:.2f}/100g",
                "comparison_unit": "100g",
            }
        elif per_unit == "100g":
            return {
                "unit_price": round(price, 2),
                "unit_price_display": f"${price:.2f}/100g",
                "comparison_unit": "100g",
            }

    # Case 2: Flat price + known weight → calculate $/100g or $/100mL
    parsed = _parse_weight_grams(weight_str)
    if parsed and parsed[0] > 0:
        amount, unit_type = parsed
        if unit_type == "weight":
            price_per_100g = price / amount * 100
            return {
                "unit_price": round(price_per_100g, 2),
                "unit_price_display": f"${price_per_100g:.2f}/100g",
                "comparison_unit": "100g",
            }
        elif unit_type == "volume":
            price_per_100ml = price / amount * 100
            return {
                "unit_price": round(price_per_100ml, 2),
                "unit_price_display": f"${price_per_100ml:.2f}/100mL",
                "comparison_unit": "100mL",
            }

    return None


_OCR_SERVICE_URL = os.environ.get("OCR_SERVICE_URL", "")


async def _ocr_text_from_service(image_url: str, client: httpx.AsyncClient) -> Optional[str]:
    """Call the OCR microservice to extract raw text from an image URL."""
    if not _OCR_SERVICE_URL or not image_url:
        return None
    try:
        resp = await client.post(
            f"{_OCR_SERVICE_URL}/api/ocr/extract-text",
            json={"image_url": image_url},
            timeout=45.0,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "success":
            return data.get("text")
        return None
    except Exception as e:
        log.debug(f"[ShopperTools] OCR service call failed: {e}")
        return None


async def _ocr_weight_from_service(image_url: str, client: httpx.AsyncClient) -> Optional[Dict[str, str]]:
    """Use the OCR microservice to extract weight info from a flyer image."""
    ocr_text = await _ocr_text_from_service(image_url, client)
    if not ocr_text:
        return None
    result = _extract_weight_from_text(ocr_text)
    if result:
        result["source"] = "ocr"
    return result


def _parse_flipp_items(raw_items: list, limit: int = 5, query: str = "", category: Optional[str] = None) -> List[Dict[str, Any]]:
    """Parse raw Flipp API response items into a clean deal format.

    Flipp returns two item types:
    - flyer items: from weekly flyers (have merchant_name, sale_story, valid_from/to)
    - ecom items: online store listings (have merchant, description)

    If category is provided (e.g. "Food Items" or "Beverages"), only items
    whose _L2 field matches are included.
    """
    deals = []
    for item in raw_items:
        if len(deals) >= limit:
            break

        # Category filter (by _L2 field)
        if category:
            l2 = (item.get("_L2") or "").strip()
            if l2 != category:
                continue

        # Skip results that don't actually match the searched item
        if query and not _is_relevant_deal(item, query):
            continue

        # Extract price info
        price = item.get("current_price")
        pre_price_text = item.get("pre_price_text") or ""
        post_price_text = item.get("post_price_text") or ""

        if price is not None:
            display_price = f"${price:.2f}"
        else:
            display_price = "See flyer"

        # Resolve store name: flyer items use merchant_name, ecom items use merchant
        store = item.get("merchant_name") or item.get("merchant") or "Unknown Store"

        # Get image URL
        image_url = item.get("clean_image_url") or item.get("clipping_image_url") or item.get("image_url", "")

        # Extract weight/size from text fields (not post_price_text — that's a pricing unit)
        item_name = item.get("name") or item.get("description") or "Unknown Item"
        description = item.get("description") or ""
        weight_info = _extract_weight_from_text(item_name, description)
        unit_price_info = _calc_unit_price(
            price, pre_price_text, post_price_text,
            weight_info["weight"] if weight_info else None,
        )

        deal = {
            "store": store,
            "item": item_name,
            "price": display_price,
            "original_price": f"${item['original_price']:.2f}" if item.get("original_price") else None,
            "pre_price_text": pre_price_text,
            "post_price_text": post_price_text,
            "sale_story": item.get("sale_story", ""),
            "valid_from": item.get("valid_from", ""),
            "valid_to": item.get("valid_to", ""),
            "image_url": image_url,
            "item_type": item.get("item_type", ""),
            "merchant_logo": item.get("merchant_logo") or "",
            "weight": weight_info["weight"] if weight_info else None,
            "weight_source": weight_info["source"] if weight_info else None,
            "unit_price": unit_price_info["unit_price"] if unit_price_info else None,
            "unit_price_display": unit_price_info["unit_price_display"] if unit_price_info else None,
            "comparison_unit": unit_price_info["comparison_unit"] if unit_price_info else None,
        }
        deals.append(deal)

    return deals


async def find_nearby_stores(
    store_names: List[str],
    center_lat: float,
    center_lng: float,
    radius_m: int = 30000,
) -> Dict[str, List[Dict[str, Any]]]:
    """Find nearby store locations using OpenStreetMap Overpass API.

    Queries by brand tag for all store names in a single batch request.
    Returns a dict mapping each input store name to a list of nearby locations
    with lat, lng, and address.
    """
    if not store_names:
        return {}

    cache_key = f"{'|'.join(sorted(store_names))}|{center_lat:.2f},{center_lng:.2f}"
    if cache_key in _overpass_cache:
        return _overpass_cache[cache_key]

    # Build regex alternation for brand matching
    escaped_names = [name.replace('"', '\\"') for name in store_names]
    brand_regex = "|".join(escaped_names)

    query = (
        f'[out:json][timeout:10];'
        f'nwr["brand"~"{brand_regex}",i]["shop"](around:{radius_m},{center_lat},{center_lng});'
        f'out center 50;'
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                OVERPASS_API_URL,
                data={"data": query},
                headers={"User-Agent": "SmartAppetiteManager/1.0 (hackathon project)"},
            )
            resp.raise_for_status()
            data = resp.json()

        # Group results by matching store name
        results: Dict[str, List[Dict[str, Any]]] = {name: [] for name in store_names}
        name_lower_map = {name.lower(): name for name in store_names}

        for element in data.get("elements", []):
            tags = element.get("tags", {})
            # Get coordinates (nodes have lat/lon directly, ways/relations have center)
            lat = element.get("lat") or (element.get("center", {}) or {}).get("lat")
            lng = element.get("lon") or (element.get("center", {}) or {}).get("lon")
            if lat is None or lng is None:
                continue

            # Build address from addr:* tags
            addr_parts = []
            house = tags.get("addr:housenumber", "")
            street = tags.get("addr:street", "")
            city = tags.get("addr:city", "")
            if house and street:
                addr_parts.append(f"{house} {street}")
            elif street:
                addr_parts.append(street)
            if city:
                addr_parts.append(city)
            address = ", ".join(addr_parts) if addr_parts else ""

            # Match to input store name via brand or name tag
            brand = (tags.get("brand") or tags.get("name") or "").lower()
            matched_name = None
            for input_lower, input_original in name_lower_map.items():
                if input_lower in brand or brand in input_lower:
                    matched_name = input_original
                    break

            if matched_name:
                results[matched_name].append({
                    "name": tags.get("name") or matched_name,
                    "lat": float(lat),
                    "lng": float(lng),
                    "address": address,
                })

        _overpass_cache[cache_key] = results
        log.info(f"[ShopperTools] Overpass returned stores for {len([n for n, v in results.items() if v])} of {len(store_names)} chains")
        return results

    except Exception as e:
        log.warning(f"[ShopperTools] Overpass query failed: {e}")
        return {name: [] for name in store_names}


async def check_local_flyers(
    item_name: str,
    location: str = "Ottawa, Ontario, Canada",
    limit: int = 5,
    category: Optional[str] = None,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Search Flipp for current grocery flyer deals on an item near the user's postal code."""
    log.info(f"[ShopperTools] Checking Flipp flyers for: {item_name}")

    postal_code = (tool_config.get("postal_code") if tool_config else None) or "K1A 0A6"
    locale = (tool_config.get("locale") if tool_config else None) or "en-us"

    params = {
        "locale": locale,
        "postal_code": postal_code,
        "q": item_name,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(FLIPP_SEARCH_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

            raw_items = data.get("items", [])
            if not raw_items:
                return {"status": "not_found", "message": f"No flyer deals found for '{item_name}'."}

            deals = _parse_flipp_items(raw_items, limit=limit, query=item_name, category=category)
            if not deals:
                return {"status": "not_found", "message": f"No relevant flyer deals found for '{item_name}'."}

            # OCR fallback: for deals missing weight, try reading the flyer image
            if _OCR_SERVICE_URL:
                ocr_tasks = []
                for deal in deals:
                    if not deal.get("weight") and deal.get("image_url"):
                        ocr_tasks.append((deal, _ocr_weight_from_service(deal["image_url"], client)))
                if ocr_tasks:
                    ocr_results = await asyncio.gather(
                        *[task for _, task in ocr_tasks],
                        return_exceptions=True,
                    )
                    for (deal, _), result in zip(ocr_tasks, ocr_results):
                        if isinstance(result, dict) and result.get("weight"):
                            deal["weight"] = result["weight"]
                            deal["weight_source"] = "ocr"
                            # Recalculate unit price with newly discovered weight
                            try:
                                raw_price = float(deal["price"].replace("$", "").split()[0])
                            except (ValueError, IndexError):
                                raw_price = None
                            recalc = _calc_unit_price(
                                raw_price,
                                deal.get("pre_price_text", ""),
                                deal.get("post_price_text", ""),
                                result["weight"],
                            )
                            if recalc:
                                deal["unit_price"] = recalc["unit_price"]
                                deal["unit_price_display"] = recalc["unit_price_display"]
                                deal["comparison_unit"] = recalc["comparison_unit"]

            return {"status": "success", "deals": deals}

    except Exception as e:
        log.error(f"[ShopperTools] Flipp API failure: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


_FLIPP_MAX_CONCURRENT = 10


async def _fetch_item_deals(
    item: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    params_base: Dict[str, str],
) -> tuple[str, Dict[str, Any]]:
    """Fetch Flipp deals for a single item, respecting the concurrency semaphore."""
    async with semaphore:
        try:
            resp = await client.get(FLIPP_SEARCH_URL, params={**params_base, "q": item})
            resp.raise_for_status()
            raw_items = resp.json().get("items", [])

            if raw_items:
                deals = _parse_flipp_items(raw_items, limit=5, query=item)
                if deals:
                    return item, {"found": True, "options": deals}
                return item, {"found": False, "note": f"No relevant flyer deals found for '{item}'."}
            return item, {"found": False, "note": f"No flyer deals found for '{item}'."}

        except Exception as e:
            log.warning(f"[ShopperTools] Flipp search failed for '{item}': {e}")
            return item, {"found": False, "note": f"Search failed: {str(e)}"}


async def _fetch_item_names(
    item: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    params_base: Dict[str, str],
    limit: int = 20,
) -> tuple[str, Dict[str, Any]]:
    """Fetch Flipp product names for a single item (lightweight preview)."""
    async with semaphore:
        try:
            resp = await client.get(FLIPP_SEARCH_URL, params={**params_base, "q": item})
            resp.raise_for_status()
            raw_items = resp.json().get("items", [])

            names = []
            for raw in raw_items:
                if len(names) >= limit:
                    break
                if not _is_relevant_deal(raw, item):
                    continue
                name = raw.get("name") or raw.get("description") or ""
                if name:
                    names.append(name)

            if names:
                return item, {"found": True, "product_names": names}
            return item, {"found": False, "product_names": []}

        except Exception as e:
            log.warning(f"[ShopperTools] Flipp preview failed for '{item}': {e}")
            return item, {"found": False, "product_names": []}


async def preview_flipp_items(
    items: List[str],
    limit: int = 20,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Search Flipp for product names matching each grocery item to help identify
    ambiguous search terms before doing a full deal search.

    Returns product names grouped by search term so you can determine which items
    need user clarification (e.g. 'chicken' returns drumsticks, luncheon meat, strips —
    very different products) vs which are specific enough (e.g. 'eggs' returns only eggs).
    """
    log_id = "[ShopperTools:preview_flipp_items]"
    try:
        postal_code = (tool_config.get("postal_code") if tool_config else None) or "K1A 0A6"
        locale = (tool_config.get("locale") if tool_config else None) or "en-us"
        params_base = {"locale": locale, "postal_code": postal_code}

        semaphore = asyncio.Semaphore(_FLIPP_MAX_CONCURRENT)
        async with httpx.AsyncClient(timeout=15.0) as client:
            pairs = await asyncio.gather(
                *[_fetch_item_names(item, client, semaphore, params_base, limit) for item in items]
            )

        results = dict(pairs)
        log.info(f"{log_id} Previewed {len(items)} items")
        return {"status": "success", "items": results}

    except Exception as e:
        log.error(f"{log_id} Failed: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


async def find_best_deals_batch(
    items: List[str],
    location: str = "Ottawa, Ontario, Canada",
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Search Flipp for the best deals on a list of grocery items, returning results per item."""
    try:
        postal_code = (tool_config.get("postal_code") if tool_config else None) or "K1A 0A6"
        locale = (tool_config.get("locale") if tool_config else None) or "en-us"
        params_base = {"locale": locale, "postal_code": postal_code}

        semaphore = asyncio.Semaphore(_FLIPP_MAX_CONCURRENT)
        async with httpx.AsyncClient(timeout=15.0) as client:
            pairs = await asyncio.gather(
                *[_fetch_item_deals(item, client, semaphore, params_base) for item in items]
            )

        results = dict(pairs)
        return {"status": "success", "summary": results, "location_used": location, "postal_code": postal_code}

    except Exception as e:
        log.error(f"[ShopperTools] Batch search failed: {e}", exc_info=True)
        return {"status": "error", "message": f"Batch search failed: {str(e)}"}


async def find_deals_with_map(
    items: List[str],
    location: str = "Ottawa, Ontario, Canada",
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Search Flipp for deals on a list of grocery items, then geocode stores for map display.

    Returns deal results per item plus a shopper_map_data structure with store
    coordinates for rendering an interactive map on the frontend.
    """
    try:
        postal_code = (tool_config.get("postal_code") if tool_config else None) or "K1A 0A6"
        locale = (tool_config.get("locale") if tool_config else None) or "en-us"
        map_center_lat = float(tool_config.get("map_center_lat", 45.4215)) if tool_config else 45.4215
        map_center_lng = float(tool_config.get("map_center_lng", -75.6972)) if tool_config else -75.6972
        params_base = {"locale": locale, "postal_code": postal_code}

        # Fetch all items concurrently
        semaphore = asyncio.Semaphore(_FLIPP_MAX_CONCURRENT)
        async with httpx.AsyncClient(timeout=15.0) as client:
            pairs = await asyncio.gather(
                *[_fetch_item_deals(item, client, semaphore, params_base) for item in items]
            )

        results = dict(pairs)

        # Track which stores carry which items + best price
        store_items: Dict[str, Dict[str, Any]] = {}
        for item, data in results.items():
            if not data.get("found"):
                continue
            best_per_store: Dict[str, Dict[str, Any]] = {}
            for deal in data["options"]:
                store = deal["store"]
                price_val = 0.0
                price_str = deal.get("price", "")
                try:
                    price_val = float(price_str.replace("$", "").split()[0])
                except (ValueError, IndexError):
                    pass
                if store not in best_per_store or price_val < best_per_store[store]["price_val"]:
                    best_per_store[store] = {
                        "name": item,
                        "price": deal["price"],
                        "sale_story": deal.get("sale_story", ""),
                        "price_val": price_val,
                    }
            for store, best in best_per_store.items():
                if store not in store_items:
                    store_items[store] = {"items": [], "total": 0.0}
                store_items[store]["items"].append({
                    "name": best["name"],
                    "price": best["price"],
                    "sale_story": best["sale_story"],
                })
                store_items[store]["total"] += best["price_val"]

        # Determine recommended store (most items, then lowest total)
        recommended_store = None
        if store_items:
            recommended_store = max(
                store_items.keys(),
                key=lambda s: (len(store_items[s]["items"]), -store_items[s]["total"])
            )

        # Batch-fetch all nearby store locations via Overpass
        nearby = await find_nearby_stores(
            list(store_items.keys()), map_center_lat, map_center_lng
        )
        store_locations = []
        for store_name, store_data in store_items.items():
            locations = nearby.get(store_name, [])
            if locations:
                best = min(
                    locations,
                    key=lambda loc: (loc["lat"] - map_center_lat) ** 2
                    + (loc["lng"] - map_center_lng) ** 2,
                )
                store_locations.append({
                    "store": store_name,
                    "lat": best["lat"],
                    "lng": best["lng"],
                    "address": best.get("address", ""),
                    "items": store_data["items"],
                    "total": round(store_data["total"], 2),
                    "is_recommended": store_name == recommended_store,
                })

        shopper_map_data = {
            "stores": store_locations,
            "center": {"lat": map_center_lat, "lng": map_center_lng},
            "recommended_store": recommended_store,
        }

        return {
            "status": "success",
            "summary": results,
            "shopper_map_data": shopper_map_data,
            "location_used": location,
            "postal_code": postal_code,
        }

    except Exception as e:
        log.error(f"[ShopperTools] Batch map search failed: {e}", exc_info=True)
        return {"status": "error", "message": f"Batch map search failed: {str(e)}"}
