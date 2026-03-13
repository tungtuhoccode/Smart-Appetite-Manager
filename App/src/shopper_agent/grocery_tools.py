import logging
import httpx
import asyncio
import os
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk import trace, set_tag
from typing import Any, Dict, Optional, List


log = logging.getLogger(__name__)

# Initialize Sentry if DSN is present
sentry_dsn = os.getenv("SENTRY_DSN")
if sentry_dsn and sentry_dsn.startswith("https"):
    try:
        def filter_noise(event, hint):
            if 'exception' not in event and event.get('level') in ['info', 'debug']:
                return None
            return event

        sentry_logging = LoggingIntegration(
            level=logging.INFO,
            event_level=logging.ERROR
        )

        sentry_sdk.init(
            dsn=sentry_dsn,
            integrations=[sentry_logging],
            traces_sample_rate=1.0,
            profiles_sample_rate=1.0,
            environment="hackathon-demo",
            send_default_pii=True,
            before_send=filter_noise
        )
        log.info("[ShopperTools] Sentry Initialized (Performance + Tagging Enabled).")
    except Exception as e:
        log.warning(f"[ShopperTools] Failed to initialize Sentry: {e}")
else:
    log.warning("[ShopperTools] Sentry DSN not found or invalid. Skipping initialization.")

FLIPP_SEARCH_URL = "https://backflipp.wishabi.com/flipp/items/search"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"

# In-memory geocode cache to avoid redundant Nominatim lookups
_geocode_cache: Dict[str, Optional[Dict[str, float]]] = {}

def safe_set_tag(key: str, value: Any):
    """Safely sets a Sentry tag, ignoring errors if Sentry is not ready."""
    try:
        if sentry_sdk.Hub.current.client:
            set_tag(key, value)
    except Exception:
        pass


_NON_GROCERY_KEYWORDS = {
    "dog", "cat", "pet", "puppy", "kitten", "feline", "canine",
    "bird", "fish tank", "aquarium", "reptile", "hamster",
}

_NON_GROCERY_STORES = {
    "pet valu", "petsmart", "petland", "global pet foods", "ren's pets",
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

    # Exclude items with pet-food keywords
    for kw in _NON_GROCERY_KEYWORDS:
        if kw in item_text:
            return False

    # All significant words from the query must appear in the item text.
    # Split query into words, ignore very short words (a, of, etc.)
    query_words = [w for w in query.lower().split() if len(w) > 2]
    if not query_words:
        return True

    return all(word in item_text for word in query_words)


def _parse_flipp_items(raw_items: list, limit: int = 5, query: str = "") -> List[Dict[str, Any]]:
    """Parse raw Flipp API response items into a clean deal format.

    Flipp returns two item types:
    - flyer items: from weekly flyers (have merchant_name, sale_story, valid_from/to)
    - ecom items: online store listings (have merchant, description)
    """
    deals = []
    for item in raw_items:
        if len(deals) >= limit:
            break

        # Skip results that don't actually match the searched item
        if query and not _is_relevant_deal(item, query):
            continue

        # Extract price info
        price = item.get("current_price")
        pre_price_text = item.get("pre_price_text") or ""
        post_price_text = item.get("post_price_text") or ""

        if price is not None:
            display_price = f"${price:.2f}"
            if post_price_text:
                display_price += f" {post_price_text}"
        else:
            display_price = "See flyer"

        # Resolve store name: flyer items use merchant_name, ecom items use merchant
        store = item.get("merchant_name") or item.get("merchant") or "Unknown Store"

        # Get image URL
        image_url = item.get("clean_image_url") or item.get("clipping_image_url") or item.get("image_url", "")

        deals.append({
            "store": store,
            "item": item.get("name") or item.get("description") or "Unknown Item",
            "price": display_price,
            "original_price": f"${item['original_price']:.2f}" if item.get("original_price") else None,
            "pre_price_text": pre_price_text,
            "post_price_text": post_price_text,
            "sale_story": item.get("sale_story", ""),
            "valid_from": item.get("valid_from", ""),
            "valid_to": item.get("valid_to", ""),
            "image_url": image_url,
            "item_type": item.get("item_type", ""),
        })

    return deals


async def _geocode_store(
    store_name: str,
    center_lat: float,
    center_lng: float,
    client: httpx.AsyncClient,
) -> Optional[Dict[str, float]]:
    """Geocode a store using Nominatim with a viewbox bounded to ~30km around the center.

    The viewbox + bounded=1 constrains results to the local area, so we get
    the actual nearby branch instead of a random location for the chain.
    """
    cache_key = f"{store_name}|{center_lat:.2f},{center_lng:.2f}"
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]

    # ~0.3 degrees ≈ 30km bounding box around center
    OFFSET = 0.3
    viewbox = f"{center_lng - OFFSET},{center_lat + OFFSET},{center_lng + OFFSET},{center_lat - OFFSET}"

    try:
        params = {
            "q": store_name,
            "format": "json",
            "limit": "1",
            "countrycodes": "ca",
            "viewbox": viewbox,
            "bounded": "1",
        }
        headers = {"User-Agent": "SmartAppetiteManager/1.0 (hackathon project)"}
        resp = await client.get(NOMINATIM_SEARCH_URL, params=params, headers=headers)
        resp.raise_for_status()
        results = resp.json()

        if results:
            coords = {"lat": float(results[0]["lat"]), "lng": float(results[0]["lon"])}
            _geocode_cache[cache_key] = coords
            return coords

    except Exception as e:
        log.warning(f"[ShopperTools] Geocode failed for '{store_name}': {e}")

    _geocode_cache[cache_key] = None
    return None


@trace
async def check_local_flyers(
    item_name: str,
    location: str = "Ottawa, Ontario, Canada",
    limit: int = 5,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Search Flipp for current grocery flyer deals on an item near the user's postal code."""
    safe_set_tag("search_item", item_name)
    safe_set_tag("search_type", "flyer")
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

        deals = _parse_flipp_items(raw_items, limit=limit, query=item_name)
        if not deals:
            return {"status": "not_found", "message": f"No relevant flyer deals found for '{item_name}'."}
        return {"status": "success", "deals": deals}

    except Exception as e:
        log.error(f"[ShopperTools] Flipp API failure: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


@trace
async def find_best_deals_batch(
    items: List[str],
    location: str = "Ottawa, Ontario, Canada",
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Search Flipp for the best deals on a list of grocery items, returning results per item."""
    try:
        safe_set_tag("batch_size", len(items))
        safe_set_tag("search_type", "batch")

        postal_code = (tool_config.get("postal_code") if tool_config else None) or "K1A 0A6"
        locale = (tool_config.get("locale") if tool_config else None) or "en-us"

        results = {}

        async with httpx.AsyncClient(timeout=15.0) as client:
            for item in items:
                params = {
                    "locale": locale,
                    "postal_code": postal_code,
                    "q": item,
                }
                try:
                    resp = await client.get(FLIPP_SEARCH_URL, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                    raw_items = data.get("items", [])

                    if raw_items:
                        deals = _parse_flipp_items(raw_items, limit=5, query=item)
                        if deals:
                            results[item] = {"found": True, "options": deals}
                        else:
                            results[item] = {"found": False, "note": f"No relevant flyer deals found for '{item}'."}
                    else:
                        results[item] = {"found": False, "note": f"No flyer deals found for '{item}'."}

                except Exception as e:
                    log.warning(f"[ShopperTools] Flipp search failed for '{item}': {e}")
                    results[item] = {"found": False, "note": f"Search failed: {str(e)}"}

        return {"status": "success", "summary": results, "location_used": location, "postal_code": postal_code}

    except Exception as e:
        log.error(f"[ShopperTools] Batch search failed: {e}", exc_info=True)
        return {"status": "error", "message": f"Batch search failed: {str(e)}"}


@trace
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
        safe_set_tag("batch_size", len(items))
        safe_set_tag("search_type", "batch_map")

        postal_code = (tool_config.get("postal_code") if tool_config else None) or "K1A 0A6"
        locale = (tool_config.get("locale") if tool_config else None) or "en-us"
        map_center_lat = float(tool_config.get("map_center_lat", 45.4215)) if tool_config else 45.4215
        map_center_lng = float(tool_config.get("map_center_lng", -75.6972)) if tool_config else -75.6972

        results = {}
        # Track which stores carry which items + best price
        store_items: Dict[str, Dict[str, Any]] = {}  # store_name -> {items: [...], total: float}

        async with httpx.AsyncClient(timeout=15.0) as client:
            for item in items:
                params = {"locale": locale, "postal_code": postal_code, "q": item}
                try:
                    resp = await client.get(FLIPP_SEARCH_URL, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                    raw_items = data.get("items", [])

                    if raw_items:
                        deals = _parse_flipp_items(raw_items, limit=5, query=item)
                        if deals:
                            results[item] = {"found": True, "options": deals}

                            # Track best (cheapest) price per store for this item
                            best_per_store: Dict[str, Dict[str, Any]] = {}
                            for deal in deals:
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
                        else:
                            results[item] = {"found": False, "note": f"No relevant flyer deals found for '{item}'."}
                    else:
                        results[item] = {"found": False, "note": f"No flyer deals found for '{item}'."}

                except Exception as e:
                    log.warning(f"[ShopperTools] Flipp search failed for '{item}': {e}")
                    results[item] = {"found": False, "note": f"Search failed: {str(e)}"}

            # Determine recommended store (most items, then lowest total)
            recommended_store = None
            if store_items:
                recommended_store = max(
                    store_items.keys(),
                    key=lambda s: (len(store_items[s]["items"]), -store_items[s]["total"])
                )

            # Geocode unique stores (with 1s delay between requests per Nominatim policy)
            store_locations = []
            for store_name, store_data in store_items.items():
                coords = await _geocode_store(store_name, map_center_lat, map_center_lng, client)
                if coords:
                    store_locations.append({
                        "store": store_name,
                        "lat": coords["lat"],
                        "lng": coords["lng"],
                        "items": store_data["items"],
                        "total": round(store_data["total"], 2),
                        "is_recommended": store_name == recommended_store,
                    })
                    await asyncio.sleep(1.1)  # Nominatim rate limit

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
