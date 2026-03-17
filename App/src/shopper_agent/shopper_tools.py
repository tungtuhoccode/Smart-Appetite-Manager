"""
Shopper planning tools — multi-step pipeline for finding the best grocery deals.

Pipeline:
  Step 1: fetch_flipp_raw        — Call Flipp API, return raw product names per search term
  Step 2: filter_flipp_results   — Apply LLM-generated exclude lists to remove irrelevant items
  Step 3: tag_price_types        — Tag each deal as flat / per_lb / per_100g (deterministic)
  Step 4: build_store_comparison — Infer missing prices from Walmart ecom baseline + tier markup
  Step 5: find_nearby_stores     — Geocode stores via Overpass API (lat/lng/address)
  Step 6: (done by the LLM agent — reasons about the best 1-2 store combo)
"""

import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx

from shopper_agent.grocery_tools import find_nearby_stores

log = logging.getLogger(__name__)

FLIPP_SEARCH_URL = "https://backflipp.wishabi.com/flipp/items/search"
_FLIPP_MAX_CONCURRENT = 10

# Store tiers: markup over Walmart baseline for price inference
STORE_TIERS = {
    # Budget (+0%)
    "No Frills": ("budget", 0.0),
    "FreshCo": ("budget", 0.0),
    "Super C": ("budget", 0.0),
    "Maxi": ("budget", 0.0),
    "Food Basics": ("budget", 0.0),
    "Giant Tiger": ("budget", 0.0),
    # Mid (+5%)
    "Walmart": ("mid", 0.0),
    "Real Canadian Superstore": ("mid", 0.05),
    "Costco": ("mid", 0.0),
    # Premium (+10-20%)
    "Loblaws": ("premium", 0.15),
    "Metro": ("premium", 0.15),
    "Sobeys": ("premium", 0.15),
    "Farm Boy": ("premium", 0.20),
    "IGA": ("premium", 0.15),
    "Your Independent Grocer": ("premium", 0.15),
    "Provigo": ("premium", 0.10),
    "Adonis": ("premium", 0.10),
    "Shoppers Drug Mart": ("premium", 0.20),
    "Pharmaprix": ("premium", 0.20),
    "Rexall": ("premium", 0.20),
}

NON_GROCERY_STORES = {
    "pet valu", "petsmart", "petland", "best buy", "the source", "staples",
    "canadian tire", "home hardware", "leon's", "the brick", "ikea",
    "long & mcquade musical instruments", "party city", "sephora", "lcbo",
    "best new product awards", "eb games canada", "mark's",
    "bath depot", "linen chest", "rona & rona +", "bureau en gros",
}


# ---------------------------------------------------------------------------
# LLM call helper (reused from receipt_scanner_tools pattern)
# ---------------------------------------------------------------------------
async def _call_llm(
    messages: List[Dict[str, Any]],
    model: str,
    api_base: str,
    api_key: str,
    log_id: str,
    max_tokens: int = 4096,
    temperature: float = 0.1,
    timeout: float = 180.0,
) -> Dict[str, Any]:
    """Make an OpenAI-compatible chat completion call. Returns parsed JSON or error dict."""
    url = f"{api_base}/v1/chat/completions"
    if "/v1/" in api_base or api_base.endswith("/v1"):
        url = f"{api_base}/chat/completions"

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPStatusError as e:
        body = e.response.text[:500] if e.response else ""
        log.error(f"{log_id} LLM HTTP error {e.response.status_code}: {body}")
        return {"error": f"LLM error ({e.response.status_code}): {body}"}
    except Exception as e:
        log.error(f"{log_id} LLM request failed: {e}", exc_info=True)
        return {"error": f"LLM request failed: {e}"}

    try:
        content = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        log.error(f"{log_id} Unexpected LLM response: {e}")
        return {"error": "Unexpected response from LLM."}

    if content is None:
        log.error(f"{log_id} LLM returned null content")
        return {"error": "LLM returned empty/null content."}

    text = content.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        log.error(f"{log_id} JSON parse failed: {e}\nRaw: {text[:500]}")
        return {"error": f"Failed to parse LLM response: {e}", "raw": text[:1000]}

    return {"data": parsed}


# ---------------------------------------------------------------------------
# Step 1: Fetch raw data from Flipp
# ---------------------------------------------------------------------------
def _basic_food_filter(item: dict) -> bool:
    """Quick pre-filter: exclude non-grocery stores and non-food categories."""
    store = (item.get("merchant_name") or item.get("merchant") or "").lower()
    if store in NON_GROCERY_STORES:
        return False
    l1 = (item.get("_L1") or "").strip()
    if l1 and l1 != "Food, Beverages & Tobacco":
        return False
    return True


async def _fetch_single_item(
    search_term: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    params_base: Dict[str, str],
) -> tuple:
    """Fetch both flyer and ecom results for a single search term."""
    async with semaphore:
        try:
            resp = await client.get(
                FLIPP_SEARCH_URL, params={**params_base, "q": search_term}
            )
            resp.raise_for_status()
            data = resp.json()

            flyer_items = []
            for raw in data.get("items", []):
                if not _basic_food_filter(raw):
                    continue
                flyer_items.append({
                    "flyer_item_id": raw.get("flyer_item_id") or raw.get("id"),
                    "name": raw.get("name") or raw.get("description") or "Unknown",
                    "store": raw.get("merchant_name") or "Unknown",
                    "price": raw.get("current_price"),
                    "post_price_text": raw.get("post_price_text") or "",
                    "pre_price_text": raw.get("pre_price_text") or "",
                    "original_price": raw.get("original_price"),
                    "sale_story": raw.get("sale_story") or "",
                    "valid_to": raw.get("valid_to") or "",
                    "image_url": raw.get("clean_image_url") or raw.get("clipping_image_url") or "",
                    "store_logo": raw.get("merchant_logo") or "",
                })

            ecom_items = []
            for raw in data.get("ecom_items", []):
                if not _basic_food_filter(raw):
                    continue
                ecom_items.append({
                    "item_id": raw.get("item_id") or raw.get("sku"),
                    "name": raw.get("name") or raw.get("description") or "Unknown",
                    "store": raw.get("merchant") or "Unknown",
                    "price": raw.get("current_price"),
                    "original_price": raw.get("original_price"),
                    "store_logo": raw.get("merchant_logo") or "",
                })

            return search_term, {"flyer": flyer_items, "ecom": ecom_items}

        except Exception as e:
            log.warning(f"[ShopperTools] Flipp fetch failed for '{search_term}': {e}")
            return search_term, {"flyer": [], "ecom": []}


async def fetch_flipp_raw(
    items: List[str],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Step 1: Call Flipp API for all items. Returns raw product names grouped by search term.

    The LLM should review the product names and call filter_flipp_results
    with an exclude list to remove irrelevant items.
    """
    log_id = "[ShopperTools:fetch_flipp_raw]"
    log.info(f"{log_id} Fetching {len(items)} items from Flipp")

    postal_code = (tool_config.get("postal_code") if tool_config else None) or "K1A 0A6"
    locale = (tool_config.get("locale") if tool_config else None) or "en-us"
    params_base = {"locale": locale, "postal_code": postal_code}

    semaphore = asyncio.Semaphore(_FLIPP_MAX_CONCURRENT)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            pairs = await asyncio.gather(
                *[_fetch_single_item(item, client, semaphore, params_base) for item in items]
            )
        raw_metrics = dict(pairs)
        log.info(f"{log_id} Fetched data for {len(raw_metrics)} items")
        return {"status": "success", "raw_metrics": raw_metrics}

    except Exception as e:
        log.error(f"{log_id} Failed: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


# ---------------------------------------------------------------------------
# Step 2: LLM-powered relevance filter
# ---------------------------------------------------------------------------
async def _generate_exclude_list_via_llm(
    raw_metrics: Dict[str, Any],
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[str]]:
    """Call LLM to generate exclude lists for each search term."""
    log_id = "[ShopperTools:generate_exclude_list]"

    cfg = tool_config or {}
    raw_model = (
        cfg.get("model")
        or cfg.get("model_name")
        or os.getenv("LLM_SERVICE_GENERAL_MODEL_NAME", "gpt-4o")
    )
    model = raw_model.split("/", 1)[-1] if "/" in raw_model else raw_model
    api_base = (cfg.get("api_base") or cfg.get("endpoint", "")).rstrip("/")
    api_key = cfg.get("api_key", "")

    if not api_base or not api_key:
        log.warning(f"{log_id} No LLM config, returning empty exclude lists")
        return {}

    # Build prompt with all product names
    items_summary = {}
    for search_term, data in raw_metrics.items():
        flyer_names = [d["name"] for d in data.get("flyer", [])]
        ecom_names = [d["name"] for d in data.get("ecom", [])]
        items_summary[search_term] = {
            "flyer_names": flyer_names,
            "ecom_names": ecom_names,
        }

    system_prompt = """You are a grocery shopping assistant. A user has a shopping list and we searched for each item in a flyer/deal database. The search engine uses fuzzy matching, so many results are wrong.

Your job: for each search term, look at the returned product names and decide which ones are NOT what the user is looking for. The search term itself tells you what the user wants — use your judgment to determine their intent.

Return a JSON object where each key is the search term and the value is an array of product names to EXCLUDE. Only exclude items you are confident are wrong. When in doubt, keep the item.

Return ONLY valid JSON, no explanation."""

    user_prompt = f"The user's shopping list: {list(items_summary.keys())}\n\nSearch results:\n{json.dumps(items_summary, indent=2)}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    result = await _call_llm(
        messages=messages,
        model=model,
        api_base=api_base,
        api_key=api_key,
        log_id=log_id,
        max_tokens=16384,
        temperature=0.1,
    )

    if "error" in result:
        log.warning(f"{log_id} LLM exclude generation failed: {result['error']}")
        return {}

    exclude_data = result.get("data", {})
    if not isinstance(exclude_data, dict):
        log.warning(f"{log_id} LLM returned non-dict: {type(exclude_data)}")
        return {}

    # Log what the LLM wants to exclude
    for term, names in exclude_data.items():
        log.info(f"{log_id} Excluding {len(names)} items for '{term}'")

    return exclude_data


async def filter_flipp_results(
    raw_metrics: Dict[str, Any],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Step 2: Use LLM to identify irrelevant items, then filter them out.

    Calls the LLM internally to generate per-item exclude lists, then applies them.
    Returns filtered data with a 'removed' list for transparency.
    """
    log_id = "[ShopperTools:filter_flipp_results]"
    log.info(f"{log_id} Filtering {len(raw_metrics)} search terms")

    exclude_map = await _generate_exclude_list_via_llm(raw_metrics, tool_config)

    filtered_metrics = {}
    for search_term, data in raw_metrics.items():
        excludes = set(e.lower() for e in exclude_map.get(search_term, []))
        removed = []

        filtered_flyer = []
        for item in data.get("flyer", []):
            if item["name"].lower() in excludes:
                removed.append(item["name"])
            else:
                filtered_flyer.append(item)

        filtered_ecom = []
        for item in data.get("ecom", []):
            if item["name"].lower() in excludes:
                removed.append(item["name"])
            else:
                filtered_ecom.append(item)

        filtered_metrics[search_term] = {
            "flyer": filtered_flyer,
            "ecom": filtered_ecom,
            "removed": removed,
        }
        log.info(f"{log_id} '{search_term}': kept {len(filtered_flyer)} flyer + {len(filtered_ecom)} ecom, removed {len(removed)}")

    return {"status": "success", "filtered_metrics": filtered_metrics}


# ---------------------------------------------------------------------------
# Step 2b: Enrich items with details from product names
# ---------------------------------------------------------------------------
async def enrich_flipp_results(
    filtered_metrics: Dict[str, Any],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Step 2b: Ask LLM to add structured details to each product based on its name.

    The filter step removes obvious junk, but items that pass may still be
    ambiguous (e.g. "OCEAN'S PINK SALMON" is canned, not fresh;
    "Verka clarified butter" is ghee). This step adds a short 'detail' tag
    so the reasoning LLM in Step 5 can distinguish variants.

    Runs on filtered results only — never wastes tokens on removed items.
    """
    log_id = "[ShopperTools:enrich_flipp_results]"

    cfg = tool_config or {}
    raw_model = (
        cfg.get("model")
        or cfg.get("model_name")
        or os.getenv("LLM_SERVICE_GENERAL_MODEL_NAME", "gpt-4o")
    )
    model = raw_model.split("/", 1)[-1] if "/" in raw_model else raw_model
    api_base = (cfg.get("api_base") or cfg.get("endpoint", "")).rstrip("/")
    api_key = cfg.get("api_key", "")

    if not api_base or not api_key:
        log.warning(f"{log_id} No LLM config, skipping enrichment")
        return {"status": "success", "enriched_metrics": filtered_metrics}

    # Build a compact list of unique product names per search term
    # Only flyer items — ecom items are just for baseline, they don't need enrichment
    names_by_term = {}
    for search_term, data in filtered_metrics.items():
        names = set()
        for item in data.get("flyer", []):
            names.add(item["name"])
        names_by_term[search_term] = sorted(names)

    system_prompt = """You are a grocery product classifier. The user searched for grocery items and got product names back. For each product name, add a short detail tag that describes what it actually is.

Focus on details that help distinguish between variants:
- fresh vs frozen vs canned vs dried
- raw vs prepared/cooked vs smoked vs marinated
- regular vs specialty variant (e.g. clarified butter vs regular butter, basmati rice vs instant rice)
- size/quantity if obvious from the name

Return a JSON object where each key is the search term and the value is an object mapping product name -> detail string.

Keep details very short (2-5 words).

Return ONLY valid JSON, no explanation."""

    user_prompt = f"The user's shopping list: {list(names_by_term.keys())}\n\nProducts to classify:\n{json.dumps(names_by_term, indent=2)}"

    result = await _call_llm(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        model=model,
        api_base=api_base,
        api_key=api_key,
        log_id=log_id,
        max_tokens=16384,
        temperature=0.1,
    )

    if "error" in result:
        log.warning(f"{log_id} LLM enrichment failed: {result['error']}, skipping")
        return {"status": "success", "enriched_metrics": filtered_metrics}

    enrichment_data = result.get("data", {})
    if not isinstance(enrichment_data, dict):
        log.warning(f"{log_id} LLM returned non-dict, skipping enrichment")
        return {"status": "success", "enriched_metrics": filtered_metrics}

    # Apply detail tags to items
    enriched_metrics = {}
    enriched_count = 0
    for search_term, data in filtered_metrics.items():
        details_map = enrichment_data.get(search_term, {})

        enriched_flyer = []
        for item in data.get("flyer", []):
            detail = details_map.get(item["name"])
            if detail:
                enriched_flyer.append({**item, "detail": detail})
                enriched_count += 1
            else:
                enriched_flyer.append(item)

        enriched_ecom = []
        for item in data.get("ecom", []):
            detail = details_map.get(item["name"])
            if detail:
                enriched_ecom.append({**item, "detail": detail})
                enriched_count += 1
            else:
                enriched_ecom.append(item)

        enriched_metrics[search_term] = {
            "flyer": enriched_flyer,
            "ecom": enriched_ecom,
            "removed": data.get("removed", []),
        }

    log.info(f"{log_id} Enriched {enriched_count} items with detail tags")
    return {"status": "success", "enriched_metrics": enriched_metrics}


# ---------------------------------------------------------------------------
# Step 3: Tag price types
# ---------------------------------------------------------------------------
_PER_LB_RE = re.compile(r'(?:/\s*)?lb\b', re.IGNORECASE)
_PER_100G_RE = re.compile(r'(?:/\s*)?100\s*g\b', re.IGNORECASE)
_PER_KG_RE = re.compile(r'(?:/\s*)?kg\b', re.IGNORECASE)


def tag_price_types(filtered_metrics: Dict[str, Any]) -> Dict[str, Any]:
    """Step 3: Tag each deal with price_type based on post_price_text.

    Pure deterministic Python — no LLM needed.
    Tags: 'flat', 'per_lb', 'per_100g', 'per_kg'.
    """
    tagged_metrics = {}

    for search_term, data in filtered_metrics.items():
        tagged_flyer = []
        for item in data.get("flyer", []):
            post = item.get("post_price_text", "")
            if _PER_100G_RE.search(post):
                price_type = "per_100g"
            elif _PER_LB_RE.search(post):
                price_type = "per_lb"
            elif _PER_KG_RE.search(post):
                price_type = "per_kg"
            else:
                price_type = "flat"

            tagged_item = {**item, "price_type": price_type}
            tagged_flyer.append(tagged_item)

        # Ecom items are always flat price
        tagged_ecom = []
        for item in data.get("ecom", []):
            tagged_ecom.append({**item, "price_type": "flat"})

        tagged_metrics[search_term] = {
            "flyer": tagged_flyer,
            "ecom": tagged_ecom,
            "removed": data.get("removed", []),
        }

    return {"status": "success", "tagged_metrics": tagged_metrics}


# ---------------------------------------------------------------------------
# Step 3b: LLM picks Walmart baseline reference products
# ---------------------------------------------------------------------------
async def select_walmart_baselines(
    tagged_metrics: Dict[str, Any],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Step 3b: Ask LLM to pick the correct Walmart ecom product as baseline for each item.

    The cheapest Walmart ecom item is often wrong (cat food, baby purée, garlic butter).
    The LLM sees all Walmart ecom product names + prices and picks the one that best
    represents a normal regular-price version of what the user is looking for.
    """
    log_id = "[ShopperTools:select_walmart_baselines]"

    cfg = tool_config or {}
    raw_model = (
        cfg.get("model")
        or cfg.get("model_name")
        or os.getenv("LLM_SERVICE_GENERAL_MODEL_NAME", "gpt-4o")
    )
    model = raw_model.split("/", 1)[-1] if "/" in raw_model else raw_model
    api_base = (cfg.get("api_base") or cfg.get("endpoint", "")).rstrip("/")
    api_key = cfg.get("api_key", "")

    if not api_base or not api_key:
        log.warning(f"{log_id} No LLM config, skipping baseline selection")
        return {"status": "success", "walmart_baselines": {}}

    # Build Walmart ecom candidates per search term
    candidates_by_term = {}
    for search_term, data in tagged_metrics.items():
        candidates = []
        for item in data.get("ecom", []):
            if item["store"] != "Walmart":
                continue
            price = item.get("price")
            if price is None:
                continue
            original = item.get("original_price")
            candidates.append({
                "name": item["name"],
                "price": price,
                "original_price": original,
            })
        if candidates:
            candidates_by_term[search_term] = candidates

    if not candidates_by_term:
        log.warning(f"{log_id} No Walmart ecom candidates found")
        return {"status": "success", "walmart_baselines": {}}

    system_prompt = """You are a grocery price analyst. For each search term, you will see a list of Walmart online products with their prices. Pick the ONE product that best represents the normal, regular-priced version of what a typical shopper means by that search term.

Rules:
- Pick a standard, commonly-purchased product (e.g. for "butter" pick a regular 454g butter block, not garlic butter or a tiny specialty butter)
- Pick a product that IS the search term, not something that merely contains it as an ingredient
- Avoid pet food, baby food, snack products, or specialty/niche items
- If a product has an original_price, that represents the regular shelf price (use it as the baseline)
- If no original_price, the current price IS the regular price

Return a JSON object where each key is the search term and the value is an object with:
- "name": the exact product name you picked
- "regular_price": the original_price if available, otherwise the current price
- "reason": 2-5 words explaining why you picked it

Return ONLY valid JSON, no explanation."""

    user_prompt = f"The user's shopping list: {list(candidates_by_term.keys())}\n\nWalmart products:\n{json.dumps(candidates_by_term, indent=2)}"

    result = await _call_llm(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        model=model,
        api_base=api_base,
        api_key=api_key,
        log_id=log_id,
        max_tokens=4096,
        temperature=0.1,
    )

    if "error" in result:
        log.warning(f"{log_id} LLM baseline selection failed: {result['error']}")
        return {"status": "success", "walmart_baselines": {}}

    selection_data = result.get("data", {})
    if not isinstance(selection_data, dict):
        log.warning(f"{log_id} LLM returned non-dict")
        return {"status": "success", "walmart_baselines": {}}

    # Build baselines from LLM selections
    baselines = {}
    for search_term, selection in selection_data.items():
        if not isinstance(selection, dict):
            continue
        name = selection.get("name", "")
        regular_price = selection.get("regular_price")
        reason = selection.get("reason", "")
        if regular_price is not None:
            baselines[search_term] = {
                "regular_price": regular_price,
                "reference": name,
                "reason": reason,
            }
            log.info(f"{log_id} {search_term}: ${regular_price:.2f} <- {name[:50]} ({reason})")

    return {"status": "success", "walmart_baselines": baselines}


# ---------------------------------------------------------------------------
# Step 4: Build store comparison with Walmart baseline inference
# ---------------------------------------------------------------------------
def build_store_comparison(
    tagged_metrics: Dict[str, Any],
    walmart_baselines: Dict[str, Any],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Step 4: Build the store x item price matrix with inferred prices for gaps.

    For each store that has at least one deal across any item:
      - If it has a flyer deal for an item: use that price (source='flyer')
      - If it has an ecom price: use that (source='ecom')
      - Otherwise: infer from Walmart baseline x (1 + tier markup) (source='inferred')

    walmart_baselines is provided by select_walmart_baselines (LLM-curated).

    Returns store_comparison dict ready for the LLM to reason about.
    """
    log_id = "[ShopperTools:build_store_comparison]"
    search_terms = list(tagged_metrics.keys())

    # Collect store logos from items (first logo seen per store wins)
    store_logos: Dict[str, str] = {}

    # Collect all stores that have at least one flyer deal
    active_stores = set()
    # Also build: (store, search_term) -> best deal
    best_deals = {}  # (store, term) -> {price, name, source, price_type}

    for search_term, data in tagged_metrics.items():
        for item in data.get("flyer", []):
            store = item["store"]
            if store not in store_logos and item.get("store_logo"):
                store_logos[store] = item["store_logo"]
            price = item.get("price")
            if price is None:
                continue
            active_stores.add(store)
            key = (store, search_term)
            if key not in best_deals or price < best_deals[key]["price"]:
                best_deals[key] = {
                    "price": price,
                    "name": item["name"],
                    "detail": item.get("detail"),
                    "flyer_item_id": item.get("flyer_item_id"),
                    "image_url": item.get("image_url", ""),
                    "source": "flyer",
                    "price_type": item.get("price_type", "flat"),
                    "sale_story": item.get("sale_story", ""),
                    "valid_to": item.get("valid_to", ""),
                }

        # Also check ecom for stores that might only have online prices
        for item in data.get("ecom", []):
            store = item["store"]
            price = item.get("price")
            if price is None:
                continue
            key = (store, search_term)
            if key not in best_deals:
                best_deals[key] = {
                    "price": price,
                    "name": item["name"],
                    "detail": item.get("detail"),
                    "item_id": item.get("item_id"),
                    "source": "ecom",
                    "price_type": "flat",
                }

    # Only include stores that are in STORE_TIERS (known grocery stores)
    stores_to_include = sorted(
        [s for s in active_stores if s in STORE_TIERS],
        key=lambda s: STORE_TIERS[s][1],  # sort by tier markup
    )

    # Build store comparison
    store_comparison = {}
    for store in stores_to_include:
        tier_name, tier_markup = STORE_TIERS.get(store, ("unknown", 0.10))
        items_data = {}
        deal_count = 0
        basket_total = 0.0

        for search_term in search_terms:
            key = (store, search_term)
            if key in best_deals:
                deal = best_deals[key]
                entry = {
                    "price": deal["price"],
                    "source": deal["source"],
                    "name": deal["name"],
                    "detail": deal.get("detail"),
                    "price_type": deal.get("price_type", "flat"),
                }
                if deal.get("flyer_item_id"):
                    entry["flyer_item_id"] = deal["flyer_item_id"]
                if deal.get("item_id"):
                    entry["item_id"] = deal["item_id"]
                if deal.get("image_url"):
                    entry["image_url"] = deal["image_url"]
                if deal.get("sale_story"):
                    entry["sale_story"] = deal["sale_story"]
                if deal.get("valid_to"):
                    entry["valid_to"] = deal["valid_to"]
                items_data[search_term] = entry
                basket_total += deal["price"]
                if deal["source"] == "flyer":
                    deal_count += 1
            else:
                # Infer from Walmart baseline
                if search_term in walmart_baselines:
                    base = walmart_baselines[search_term]["regular_price"]
                    inferred = round(base * (1 + tier_markup), 2)
                    items_data[search_term] = {
                        "price": None,
                        "estimated_price": inferred,
                        "source": "inferred",
                        "note": f"Walmart baseline ${base:.2f} +{int(tier_markup*100)}%",
                    }
                    basket_total += inferred
                else:
                    items_data[search_term] = {
                        "price": None,
                        "estimated_price": None,
                        "source": "unknown",
                        "note": "no data available",
                    }

        store_comparison[store] = {
            "tier": tier_name,
            "logo_url": store_logos.get(store, ""),
            "items": items_data,
            "deal_count": deal_count,
            "basket_total": round(basket_total, 2),
        }

    return {
        "status": "success",
        "store_comparison": store_comparison,
        "walmart_baselines": walmart_baselines,
        "store_tiers": {
            "budget": [s for s, (t, _) in STORE_TIERS.items() if t == "budget"],
            "mid": [s for s, (t, _) in STORE_TIERS.items() if t == "mid"],
            "premium": [s for s, (t, _) in STORE_TIERS.items() if t == "premium"],
        },
    }


# ---------------------------------------------------------------------------
# Combined pipeline: runs all 4 steps in one call
# ---------------------------------------------------------------------------
async def find_deals_for_planning(
    items: List[str],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run the full 5-step pipeline: fetch -> filter (LLM) -> enrich (LLM) -> tag -> build comparison.

    Returns a store_comparison matrix ready for the LLM agent to reason about
    which 1-2 stores to visit for the best deals.
    """
    log_id = "[ShopperTools:find_deals_for_planning]"
    log.info(f"{log_id} Starting pipeline for {len(items)} items: {items}")

    # Step 1: Fetch raw data
    step1 = await fetch_flipp_raw(items, tool_context, tool_config)
    if step1["status"] != "success":
        return step1
    raw_metrics = step1["raw_metrics"]
    log.info(f"{log_id} Step 1 complete: fetched raw data")

    # Step 2: LLM-powered filtering
    step2 = await filter_flipp_results(raw_metrics, tool_context, tool_config)
    if step2["status"] != "success":
        return step2
    filtered_metrics = step2["filtered_metrics"]
    log.info(f"{log_id} Step 2 complete: filtered irrelevant items")

    # Step 2b: LLM-powered enrichment
    step2b = await enrich_flipp_results(filtered_metrics, tool_context, tool_config)
    if step2b["status"] != "success":
        return step2b
    enriched_metrics = step2b["enriched_metrics"]
    log.info(f"{log_id} Step 2b complete: enriched items with details")

    # Step 3: Tag price types
    step3 = tag_price_types(enriched_metrics)
    tagged_metrics = step3["tagged_metrics"]
    log.info(f"{log_id} Step 3 complete: tagged price types")

    # Step 3b: LLM selects Walmart baselines
    step3b = await select_walmart_baselines(tagged_metrics, tool_context, tool_config)
    walmart_baselines = step3b.get("walmart_baselines", {})
    log.info(f"{log_id} Step 3b complete: selected Walmart baselines")

    # Step 4: Build store comparison
    step4 = build_store_comparison(tagged_metrics, walmart_baselines, tool_context, tool_config)
    log.info(f"{log_id} Step 4 complete: built store comparison")

    # Step 5: Geocode stores via Overpass API
    cfg = tool_config or {}
    center_lat = float(cfg.get("map_center_lat", 45.4215))
    center_lng = float(cfg.get("map_center_lng", -75.6972))
    store_names = list(step4.get("store_comparison", {}).keys())

    if store_names:
        nearby = await find_nearby_stores(store_names, center_lat, center_lng)
        for store_name, store_data in step4.get("store_comparison", {}).items():
            locations = nearby.get(store_name, [])
            if locations:
                best = min(
                    locations,
                    key=lambda loc: (loc["lat"] - center_lat) ** 2
                    + (loc["lng"] - center_lng) ** 2,
                )
                store_data["lat"] = best["lat"]
                store_data["lng"] = best["lng"]
                store_data["address"] = best.get("address", "")
        log.info(f"{log_id} Step 5 complete: geocoded {len([s for s in step4['store_comparison'].values() if 'lat' in s])} of {len(store_names)} stores")

    step4["map_center"] = {"lat": center_lat, "lng": center_lng}

    # Attach removed items for transparency
    removed_summary = {}
    for term, data in filtered_metrics.items():
        if data.get("removed"):
            removed_summary[term] = data["removed"]

    step4["removed_items"] = removed_summary
    _last_pipeline_result["data"] = step4
    return step4


# ---------------------------------------------------------------------------
# Module-level cache for formatting tool to access pipeline results
# ---------------------------------------------------------------------------
_last_pipeline_result: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Formatting tool: deterministic markdown output from LLM's store picks
# ---------------------------------------------------------------------------
def _format_price(price, price_type: str = "flat", estimated: bool = False) -> str:
    """Format a price for display."""
    if price is None:
        return "N/A"
    prefix = "~" if estimated else ""
    suffix = "/lb" if price_type == "per_lb" else "/100g" if price_type == "per_100g" else ""
    return f"{prefix}${price:.2f}{suffix}"


def _is_bad_deal(item_data: dict, search_term: str) -> Optional[str]:
    """Check if a deal is misleading. Returns reason string or None."""
    if item_data.get("price_type") == "per_100g":
        price = item_data.get("price", 0)
        if price:
            per_lb = price * 4.536
            return f"per_100g = ${per_lb:.2f}/lb"
    return None


def format_deals_overview(
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Format all available deals as collapsible markdown sections. Call AFTER find_deals_for_planning.

    Returns a collapsible list of every deal found, grouped by grocery item and sorted by price.
    The agent should output this markdown before the shopping plan.
    """
    log_id = "[ShopperTools:format_deals_overview]"
    data = _last_pipeline_result.get("data")
    if not data:
        return {"status": "error", "message": "No pipeline data. Call find_deals_for_planning first."}

    store_comparison = data.get("store_comparison", {})
    search_terms = list(next(iter(store_comparison.values()), {}).get("items", {}).keys()) if store_comparison else []

    if not search_terms:
        return {"status": "error", "message": "No items in store comparison data."}

    lines = []
    lines.append("## All Available Deals\n")

    for term in search_terms:
        deals = []
        for store_name, store_data in store_comparison.items():
            item = store_data.get("items", {}).get(term, {})
            source = item.get("source", "")
            if source not in ("flyer", "ecom"):
                continue
            price = item.get("price")
            if price is None:
                continue
            deals.append({
                "store": store_name,
                "price": price,
                "price_type": item.get("price_type", "flat"),
                "name": item.get("name", ""),
                "detail": item.get("detail", ""),
                "sale_story": item.get("sale_story", ""),
                "image_url": item.get("image_url", ""),
                "source": source,
            })

        deals.sort(key=lambda d: d["price"])

        deal_count = len(deals)
        best_price = _format_price(deals[0]["price"], deals[0]["price_type"]) if deals else "N/A"
        lines.append(f"<details>")
        lines.append(f"<summary><strong>{term.title()}</strong> — {deal_count} deals, from {best_price}</summary>\n")
        lines.append("| Image | Store | Price | Product | Note |")
        lines.append("|-------|-------|-------|---------|------|")

        if not deals:
            lines.append("| | — | — | No flyer deals found | — |")
        else:
            for d in deals:
                price_str = _format_price(d["price"], d["price_type"])
                product = d["name"]
                note = d["sale_story"] or d["source"].capitalize()
                img = f"![flyer]({d['image_url']})" if d.get("image_url") else ""
                bad = _is_bad_deal(d, term)
                if bad:
                    lines.append(f"| {img} | ~~{d['store']}~~ | ~~{price_str}~~ | ~~{product}~~ | ~~{bad}~~ |")
                else:
                    lines.append(f"| {img} | {d['store']} | {price_str} | {product} | {note} |")

        lines.append("\n</details>\n")

    markdown = "\n".join(lines)
    log.info(f"{log_id} Formatted deals overview for {len(search_terms)} items")
    return {"status": "success", "formatted_markdown": markdown}


def format_shopping_plan(
    plan_items: List[Dict[str, str]],
    reasoning: str,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Format the shopping plan summary table. Call AFTER find_deals_for_planning.

    You provide the exact items for the plan and a brief reasoning. This tool
    builds the summary table with product images (looked up automatically).

    plan_items: array where each element is one row. Each must have:
      - search_term: the original grocery item (e.g. "cheddar cheese")
      - store: which store to buy from (e.g. "Super C")
      - price: display price (e.g. "$3.97", "$1.77/lb")
      - product: full product name (e.g. "FROMAGE EXTRA CHEDDAR KRAFT")
    reasoning: brief explanation of why you chose these stores.
    """
    log_id = "[ShopperTools:format_shopping_plan]"
    data = _last_pipeline_result.get("data")
    if not data:
        return {"status": "error", "message": "No pipeline data. Call find_deals_for_planning first."}

    store_comparison = data.get("store_comparison", {})

    # Build item lookup: (store_lower, term_lower) -> {flyer_item_id, image_url, name}
    # Images are tied to specific flyer_item_ids. We only use the image if the
    # LLM's chosen product matches the cached deal, preventing mismatched images
    # (e.g. "flavoured milk" image when the LLM chose estimated regular milk).
    item_lookup = {}
    for store_name, store_data in store_comparison.items():
        for term, item_data in store_data.get("items", {}).items():
            img = item_data.get("image_url")
            name = item_data.get("name", "")
            fid = item_data.get("flyer_item_id") or item_data.get("item_id")
            if img and name:
                item_lookup[(store_name.lower(), term.lower())] = {
                    "flyer_item_id": fid,
                    "image_url": img,
                    "name": name,
                }

    lines = []

    # ---- Shopping Plan ----
    store_set = set()
    total = 0.0
    for item in plan_items:
        store_set.add(item.get("store", ""))
        price_match = re.search(r'[\d.]+', item.get("price", ""))
        if price_match:
            total += float(price_match.group())

    store_label = " + ".join(sorted(store_set))
    lines.append(f"### Shopping Plan: {store_label}")
    lines.append(f"**Estimated total: ~${total:.2f}** | {len(store_set)} store{'s' if len(store_set) > 1 else ''} | {len(plan_items)} items\n")
    lines.append("| Image | Item | Store | Price | Product |")
    lines.append("|-------|------|-------|-------|---------|")

    for item in plan_items:
        search_term = item.get("search_term", "")
        store = item.get("store", "")
        price = item.get("price", "N/A")
        product = item.get("product", search_term.title())

        # Match image only if the LLM's chosen product matches the cached deal.
        # Each image is tied to a specific flyer_item_id — using the wrong one
        # shows misleading flyer images (e.g. pita bread image for "bread").
        image_url = ""
        cached = item_lookup.get((store.lower(), search_term.lower()))
        if cached:
            cached_name = cached["name"].lower().strip()
            chosen_name = product.lower().strip()
            if chosen_name in cached_name or cached_name in chosen_name:
                image_url = cached["image_url"]

        img = f"![flyer]({image_url})" if image_url else ""
        lines.append(f"| {img} | {search_term.title()} | {store} | {price} | {product} |")

    lines.append("")

    # ---- Reasoning ----
    lines.append("---\n")
    lines.append(f"**Why this combo:** {reasoning}")

    markdown = "\n".join(lines)
    log.info(f"{log_id} Formatted plan: {len(store_set)} stores, {len(plan_items)} items")
    return {"status": "success", "formatted_markdown": markdown}
