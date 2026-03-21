"""SAM tool entry point for live grocery price lookups.

Routes search requests to the correct store-specific scraper
(SSR for Loblaw PCX stores, Playwright for Metro/Food Basics/etc).
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

# Store name -> (module path, function name)
_STORE_REGISTRY: Dict[str, tuple] = {
    # SSR stores (Loblaw PCX platform)
    "loblaws": ("shopper_agent.live_pricing.ssr.loblaws", "get_loblaws_prices"),
    "real canadian superstore": ("shopper_agent.live_pricing.ssr.superstore", "get_superstore_prices"),
    "superstore": ("shopper_agent.live_pricing.ssr.superstore", "get_superstore_prices"),
    "no frills": ("shopper_agent.live_pricing.ssr.nofrills", "get_nofrills_prices"),
    "nofrills": ("shopper_agent.live_pricing.ssr.nofrills", "get_nofrills_prices"),
    "your independent grocer": ("shopper_agent.live_pricing.ssr.independent_grocer", "get_independent_grocer_prices"),
    "independent grocer": ("shopper_agent.live_pricing.ssr.independent_grocer", "get_independent_grocer_prices"),
    "provigo": ("shopper_agent.live_pricing.ssr.provigo", "get_provigo_prices"),
    "maxi": ("shopper_agent.live_pricing.ssr.maxi", "get_maxi_prices"),
    "walmart": ("shopper_agent.live_pricing.ssr.walmart", "get_walmart_prices"),
    "walmart canada": ("shopper_agent.live_pricing.ssr.walmart", "get_walmart_prices"),
    "t&t": ("shopper_agent.live_pricing.ssr.tnt", "get_tnt_prices"),
    "t&t supermarket": ("shopper_agent.live_pricing.ssr.tnt", "get_tnt_prices"),
    "tnt": ("shopper_agent.live_pricing.ssr.tnt", "get_tnt_prices"),

    # Playwright stores (headless browser)
    "metro": ("shopper_agent.live_pricing.playwright.metro", "get_metro_prices"),
    "food basics": ("shopper_agent.live_pricing.playwright.food_basics", "get_food_basics_prices"),
    "super c": ("shopper_agent.live_pricing.playwright.super_c", "get_super_c_prices"),
    "giant tiger": ("shopper_agent.live_pricing.playwright.giant_tiger", "get_giant_tiger_prices"),
    "voila": ("shopper_agent.live_pricing.playwright.voila", "get_voila_prices"),
    "freshco": ("shopper_agent.live_pricing.playwright.freshco", "get_freshco_prices"),
}

_SUPPORTED_STORES = [
    "Loblaws", "Real Canadian Superstore", "No Frills",
    "Your Independent Grocer", "Provigo", "Maxi", "Walmart", "T&T Supermarket",
    "Metro", "Food Basics", "Super C", "Giant Tiger", "Voila", "FreshCo",
]

# Store logo URLs (Wishabi/Flipp CDN — reliable, CORS-friendly raster images)
# and website links
_WISHABI = "https://images.wishabi.net/merchants"
_STORE_INFO: Dict[str, Dict[str, str]] = {
    "Loblaws":                  {"url": "https://www.loblaws.ca",               "logo": f"{_WISHABI}/2018/1526504087/storefront_logo"},
    "Real Canadian Superstore": {"url": "https://www.realcanadiansuperstore.ca","logo": f"{_WISHABI}/2271/1507308964/2271.jpg"},
    "No Frills":                {"url": "https://www.nofrills.ca",              "logo": f"{_WISHABI}/2332/1507309047/2332.jpg"},
    "Your Independent Grocer":  {"url": "https://www.yourindependentgrocer.ca", "logo": f"{_WISHABI}/2337/1526504338/storefront_logo"},
    "Provigo":                  {"url": "https://www.provigo.ca",               "logo": f"{_WISHABI}/2338/1526504164/storefront_logo"},
    "Maxi":                     {"url": "https://www.maxi.ca",                  "logo": f"{_WISHABI}/2349/1507145242/2349.jpg"},
    "Walmart":                  {"url": "https://www.walmart.ca",               "logo": f"{_WISHABI}/0a2af35c-94b2-4950-9a80-d6e7c05bc5d2/RackMultipart20250714-1-k58tqh.jpg"},
    "Metro":                    {"url": "https://www.metro.ca",                 "logo": f"{_WISHABI}/2269/1507217244/storefront_logo"},
    "Food Basics":              {"url": "https://www.foodbasics.ca",            "logo": f"{_WISHABI}/2265/1507144925/2265.jpg"},
    "Super C":                  {"url": "https://www.superc.ca",                "logo": f"{_WISHABI}/2585/1509737253/storefront_logo"},
    "Giant Tiger":              {"url": "https://www.gianttiger.com",           "logo": f"{_WISHABI}/991/1507154506/991.jpg"},
    "Voila":                    {"url": "https://voila.ca",                     "logo": f"{_WISHABI}/2018/1526504087/storefront_logo"},
    "FreshCo":                  {"url": "https://www.freshco.com",              "logo": f"{_WISHABI}/G1fLFjzsWRX1DA==/RackMultipart20191002-1-1aomrj6.jpg"},
    "T&T Supermarket":          {"url": "https://www.tntsupermarket.com",       "logo": "https://play-lh.googleusercontent.com/AqqaH6_b_RVNgVZ-NVU6EbQFjEAWc7G2bltUM3opOvAe1XDteBPSOYOiUZaM-haLYyw"},
}


def _resolve_store(store_name: str):
    """Look up the store scraper function by name. Returns the async function or None."""
    key = store_name.strip().lower()
    entry = _STORE_REGISTRY.get(key)
    if not entry:
        return None

    import importlib
    module = importlib.import_module(entry[0])
    return getattr(module, entry[1])


import re

_SLIM_FIELDS = {
    "name", "brand", "description", "display_price", "was_price",
    "member_only_price", "package_sizing", "uom", "deal",
    "price_per_unit", "price_per_kg", "price_per_lb", "price_per_L",
    "image_url", "link",
}


def _compress(d: Dict[str, Any]) -> Dict[str, Any]:
    """Remove keys with None, empty string, or empty list values."""
    return {k: v for k, v in d.items() if v is not None and v != "" and v != []}


def _truncate_description(desc: str, max_len: int = 200) -> str:
    """Strip HTML tags and truncate to max_len chars."""
    clean = re.sub(r"<[^>]+>", " ", desc).strip()
    clean = re.sub(r"\s+", " ", clean)
    if len(clean) > max_len:
        return clean[:max_len - 3] + "..."
    return clean


def _slim_product(p: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only the fields needed for price comparison reasoning."""
    slimmed = {k: v for k, v in p.items() if k in _SLIM_FIELDS}
    if slimmed.get("description"):
        slimmed["description"] = _truncate_description(slimmed["description"])
    return _compress(slimmed)


def _compress_product(p: Dict[str, Any]) -> Dict[str, Any]:
    """For detailed mode: keep all fields but strip nulls/empties and truncate description."""
    compressed = dict(p)
    if compressed.get("description"):
        compressed["description"] = _truncate_description(compressed["description"])
    return _compress(compressed)


def _slim_item_result(r: Dict[str, Any], detailed: bool = False) -> Dict[str, Any]:
    """Strip a single item result down to essential fields."""
    slimmed = {"query": r.get("query"), "status": r.get("status")}
    if r.get("result_count"):
        slimmed["result_count"] = r["result_count"]
    if r.get("message"):
        slimmed["message"] = r["message"]
    if r.get("products"):
        transform = _compress_product if detailed else _slim_product
        slimmed["products"] = [transform(p) for p in r["products"]]
    return _compress(slimmed)


def _format_product_row(i: int, p: Dict[str, Any]) -> str:
    """Format a single product as a markdown table row."""
    name = p.get("name") or p.get("title", "Unknown")
    price = p.get("display_price") or p.get("price") or "N/A"
    sizing = p.get("package_sizing") or ""
    was = p.get("was_price")
    member = p.get("member_only_price")
    deal = p.get("deal") or ""
    img = p.get("image_url") or ""

    extras = []
    if was:
        extras.append(f"~~{was}~~")
    if member:
        extras.append(f"Member: {member}")
    if deal:
        extras.append(deal)
    extra_str = " | ".join(extras)

    img_md = f"![img]({img})" if img else ""
    return f"| {i} | {img_md} | {name} | {price} | {sizing} | {extra_str} |"


def _format_results(store: str, items_results: List[Dict[str, Any]]) -> str:
    """Build a markdown summary from all item search results."""
    sections = []
    for r in items_results:
        query = r.get("query", "?")
        status = r.get("status", "error")

        if status == "error":
            sections.append(
                f"<details>\n<summary><strong>{query}</strong> — Error</summary>\n\n"
                f"{r.get('message', 'Unknown error')}\n\n</details>\n"
            )
            continue
        if status == "not_found":
            sections.append(
                f"<details>\n<summary><strong>{query}</strong> — No products found</summary>\n\n"
                f"No products found.\n\n</details>\n"
            )
            continue

        products = r.get("products", [])
        count = r.get("result_count", len(products))
        table = "| # | Image | Product | Price | Size | Notes |\n|---|-------|---------|-------|------|-------|\n"
        rows = [_format_product_row(i + 1, p) for i, p in enumerate(products)]
        sections.append(
            f"<details>\n<summary><strong>{query}</strong> — {count} results</summary>\n\n"
            + table + "\n".join(rows) + "\n\n</details>\n"
        )

    info = _STORE_INFO.get(store, {})
    logo = info.get("logo", "")
    url = info.get("url", "")
    if logo and url:
        title = f"## [![{store}]({logo})]({url}) Live Prices from [{store}]({url})\n\n"
    elif url:
        title = f"## Live Prices from [{store}]({url})\n\n"
    else:
        title = f"## Live Prices from {store}\n\n"
    return title + "\n".join(sections)


async def search_store_prices(
    store: str,
    items: list,
    max_results_per_item: int = 10,
    detailed: bool = False,
    compressed: bool = True,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Search for current shelf prices at a Canadian grocery store.

    Args:
        store: Store name (e.g. "Loblaws", "No Frills", "Metro").
        items: List of item names to search for (e.g. ["chicken breast", "eggs"]).
        max_results_per_item: Max products to return per item. Defaults to 10.
        detailed: If False (default), item_results contain only essential pricing
            fields (name, brand, price, deal, sizing, link). If True, include all
            fields. Use detailed=True only when the user asks about specific product
            attributes like ingredients, nutrition, or descriptions.
        compressed: If True (default), item_results is a compact JSON string with
            no whitespace and all null/empty values stripped. If False, item_results
            is a normal list of dicts.

    Returns:
        Dict with formatted_markdown and raw per-item results.
    """
    log_id = f"[LivePricingTool:{store}]"
    log.info(f"{log_id} Searching for {len(items)} items: {items}")

    fetch_fn = _resolve_store(store)
    if fetch_fn is None:
        supported = ", ".join(_SUPPORTED_STORES)
        return {
            "status": "error",
            "message": f"Store '{store}' is not supported. Supported stores: {supported}",
        }

    results: List[Dict[str, Any]] = []
    for item in items:
        try:
            r = await fetch_fn(query=item, max_results=max_results_per_item)
            results.append(r)
        except Exception as e:
            log.error(f"{log_id} Error fetching '{item}': {e}", exc_info=True)
            results.append({
                "status": "error",
                "query": item,
                "store": store,
                "message": str(e),
            })

    formatted = _format_results(store, results)
    log.info(f"{log_id} Done. {len(results)} item searches completed.")

    # Always compress: detailed keeps all fields (no nulls/empties), slim keeps only essential fields
    item_results = [_slim_item_result(r, detailed=detailed) for r in results]

    # Build and save a structured JSON artifact for the frontend
    artifact_filename = None
    if tool_context:
        artifact_filename = await _save_pricing_artifact(
            store, results, tool_context, log_id
        )

    response = {
        "status": "success",
        "store": store,
        "formatted_markdown": formatted,
        "item_results": json.dumps(item_results, separators=(",", ":"), ensure_ascii=False) if compressed else item_results,
    }
    if artifact_filename:
        response["artifact_filename"] = artifact_filename
    return response


def _build_artifact_products(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Build a flat list of ALL products for the frontend artifact."""
    products = []
    for r in results:
        if r.get("status") not in ("success", None):
            continue
        query = r.get("query", "")
        for p in r.get("products") or []:
            products.append(_compress({
                "query": query,
                "name": p.get("name") or p.get("title", ""),
                "brand": p.get("brand", ""),
                "price": p.get("display_price") or p.get("price", ""),
                "was_price": p.get("was_price"),
                "member_price": p.get("member_only_price"),
                "deal": p.get("deal", ""),
                "image_url": p.get("image_url", ""),
                "package_sizing": p.get("package_sizing", ""),
                "price_per_unit": p.get("price_per_unit", ""),
                "price_per_kg": p.get("price_per_kg", ""),
                "price_per_lb": p.get("price_per_lb", ""),
                "link": p.get("link", ""),
                "description": p.get("description", ""),
                "uom": p.get("uom", ""),
            }))
    return products


def _load_existing_artifact(artifact_service, session_id: str, filename: str) -> Dict[str, Any]:
    """Load the latest version of the pricing artifact from the filesystem."""
    import os
    from pathlib import Path

    base = Path(os.environ.get("SAM_ARTIFACT_BASE_PATH", "/tmp/samv2"))
    user = os.environ.get("SAM_ARTIFACT_USER", "sam_dev_user")
    artifact_dir = base / user / session_id / filename
    if not artifact_dir.is_dir():
        return {}

    versions = sorted(
        [int(f.name) for f in artifact_dir.iterdir() if f.name.isdigit()],
        reverse=True,
    )
    if not versions:
        return {}

    try:
        content = (artifact_dir / str(versions[0])).read_text(encoding="utf-8")
        return json.loads(content)
    except Exception:
        return {}


async def _save_pricing_artifact(
    store: str,
    results: List[Dict[str, Any]],
    tool_context: Any,
    log_id: str,
) -> str:
    """Save structured pricing data as a JSON artifact.

    Merges with existing artifact so multi-store queries accumulate
    all stores in a single file.
    Returns the filename or empty string.
    """
    try:
        from solace_agent_mesh.agent.utils.artifact_helpers import save_artifact_with_metadata

        new_products = _build_artifact_products(results)
        if not new_products:
            log.debug(f"{log_id} No products to save as artifact")
            return ""

        filename = "pricing-products.json"
        invocation_ctx = tool_context._invocation_context
        artifact_service = invocation_ctx.artifact_service

        # Tag each product with its store
        store_info = _STORE_INFO.get(store, {})
        for p in new_products:
            p["store"] = store

        # Try to load existing artifact and merge
        existing = _load_existing_artifact(artifact_service, invocation_ctx.session.id, filename)
        existing_stores = existing.get("stores", [])
        existing_products = existing.get("products", [])

        # Remove any old products from this same store (in case of re-query)
        existing_products = [p for p in existing_products if p.get("store") != store]
        existing_stores = [s for s in existing_stores if s.get("store") != store]

        # Merge
        all_stores = existing_stores + [{
            "store": store,
            "store_logo": store_info.get("logo", ""),
            "store_url": store_info.get("url", ""),
        }]
        all_products = existing_products + new_products

        artifact_data = {
            "stores": all_stores,
            "products": all_products,
        }
        content = json.dumps(artifact_data, ensure_ascii=False)
        timestamp = datetime.now(timezone.utc)

        await save_artifact_with_metadata(
            artifact_service=artifact_service,
            app_name=invocation_ctx.app_name,
            user_id=invocation_ctx.user_id,
            session_id=invocation_ctx.session.id,
            filename=filename,
            content_bytes=content.encode("utf-8"),
            mime_type="application/json",
            metadata_dict={
                "description": f"Live pricing products ({len(all_stores)} stores)",
                "source": "LivePricingAgent",
                "stores": [s["store"] for s in all_stores],
            },
            timestamp=timestamp,
        )
        log.info(f"{log_id} Saved pricing artifact: {filename} ({len(all_products)} products across {len(all_stores)} stores)")
        return filename

    except Exception as e:
        log.error(f"{log_id} Failed to save pricing artifact: {e}", exc_info=True)
        return ""


async def submit_ai_picks(
    picks: list,
    user_prompt: str = "",
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Submit your recommended product picks with reasons to the frontend.

    Call this AFTER presenting search results. Analyze the products and pick
    the ones that best answer the user's question. For each pick, explain
    why you chose it.

    Args:
        picks: List of recommended products. Each must have:
            - name (str): Product name — must match a product from search results
            - price (str): Display price (e.g. "$12.00")
            - store (str): Store name (e.g. "Loblaws")
            - reason (str): Why you recommend this (e.g. "Best value per kg")
            - image_url (str, optional): Product image URL
            - brand (str, optional): Brand name
            - package_sizing (str, optional): Package size info
            - link (str, optional): Product URL
        user_prompt: The user's original search question.

    Returns:
        Dict with status and number of picks saved.
    """
    log_id = "[LivePricingTool:submit_ai_picks]"
    log.info(f"{log_id} Submitting {len(picks)} AI picks")

    if not tool_context:
        return {"status": "error", "message": "Tool context not available"}

    if not picks or not isinstance(picks, list):
        return {"status": "error", "message": "No picks provided"}

    try:
        from solace_agent_mesh.agent.utils.artifact_helpers import save_artifact_with_metadata

        filename = "pricing-products.json"
        invocation_ctx = tool_context._invocation_context

        # Load existing artifact (contains stores + products from search_store_prices)
        existing = _load_existing_artifact(
            invocation_ctx.artifact_service, invocation_ctx.session.id, filename
        )

        # Build validated picks with store info
        ai_picks = []
        for p in picks:
            if not isinstance(p, dict) or not p.get("name"):
                continue
            store = p.get("store", "")
            store_info = _STORE_INFO.get(store, {})
            ai_picks.append(_compress({
                "name": p.get("name", ""),
                "price": p.get("price", ""),
                "store": store,
                "store_logo": store_info.get("logo", ""),
                "store_url": store_info.get("url", ""),
                "reason": p.get("reason", ""),
                "image_url": p.get("image_url", ""),
                "brand": p.get("brand", ""),
                "package_sizing": p.get("package_sizing", ""),
                "link": p.get("link", ""),
            }))

        if not ai_picks:
            return {"status": "error", "message": "No valid picks after validation"}

        # Merge into existing artifact
        existing["ai_picks"] = ai_picks
        existing["prompt"] = user_prompt

        content = json.dumps(existing, ensure_ascii=False)
        timestamp = datetime.now(timezone.utc)

        await save_artifact_with_metadata(
            artifact_service=invocation_ctx.artifact_service,
            app_name=invocation_ctx.app_name,
            user_id=invocation_ctx.user_id,
            session_id=invocation_ctx.session.id,
            filename=filename,
            content_bytes=content.encode("utf-8"),
            mime_type="application/json",
            metadata_dict={
                "description": f"Pricing with {len(ai_picks)} AI picks",
                "source": "LivePricingAgent",
            },
            timestamp=timestamp,
        )

        log.info(f"{log_id} Saved {len(ai_picks)} AI picks to artifact")
        return {
            "status": "success",
            "picks_saved": len(ai_picks),
            "artifact_filename": filename,
        }

    except Exception as e:
        log.error(f"{log_id} Failed: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}
