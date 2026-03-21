"""Shared logic for Loblaw PCX platform stores.

Loblaws, Real Canadian Superstore, No Frills, Your Independent Grocer,
and Shoppers Drug Mart all run on the same Next.js PCX platform with
identical __NEXT_DATA__ structures. This module provides the common
fetch/parse logic so each store tool only needs to configure its URL.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger(__name__)

_PRODUCTS_PER_PAGE = 48
_MAX_PAGES = 6

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)


def _extract_products_from_next_data(raw_json: str) -> List[Dict[str, Any]]:
    """Recursively find all product objects with pricing in the __NEXT_DATA__ JSON."""
    data = json.loads(raw_json)
    products: List[Dict[str, Any]] = []

    def _find(obj: Any, depth: int = 0) -> None:
        if depth > 15:
            return
        if isinstance(obj, dict):
            if "productId" in obj and "pricing" in obj:
                products.append(obj)
            for v in obj.values():
                _find(v, depth + 1)
        elif isinstance(obj, list):
            for item in obj:
                _find(item, depth + 1)

    _find(data)
    return products


# Patterns for parsing unit prices from PCX packageSizing strings
# "$0.33/1ea" or "$0.58/1ea"
_PCX_PER_EA_RE = re.compile(r"\$(\d+\.?\d*)/1?ea", re.IGNORECASE)
# "$0.93/100g" or "$1.99/100g"
_PCX_PER_100G_RE = re.compile(r"\$(\d+\.?\d*)/100g", re.IGNORECASE)
# "$0.16/100ml" or "$0.41/100ml"
_PCX_PER_100ML_RE = re.compile(r"\$(\d+\.?\d*)/100ml", re.IGNORECASE)
# "$11.00/1kg" or "$11.00/kg"
_PCX_PER_KG_RE = re.compile(r"\$(\d+\.?\d*)/1?kg", re.IGNORECASE)
# "$4.99/1lb" or "$4.99/lb"
_PCX_PER_LB_RE = re.compile(r"\$(\d+\.?\d*)/1?lb", re.IGNORECASE)


def _parse_pcx_unit_prices(sizing: str) -> Dict[str, Optional[float]]:
    """Parse unit prices from PCX packageSizing string.

    Examples:
        "12 ea, $0.33/1ea"        -> price_per_unit=0.33
        "4 l, $0.16/100ml"        -> price_per_L=1.6
        "700 g, $0.93/100g"       -> price_per_kg=9.3
        "$11.00/1kg $4.99/1lb"    -> price_per_kg=11.0, price_per_lb=4.99
    """
    result: Dict[str, Optional[float]] = {
        "price_per_unit": None,
        "price_per_kg": None,
        "price_per_lb": None,
        "price_per_L": None,
    }
    if not sizing:
        return result

    m = _PCX_PER_EA_RE.search(sizing)
    if m:
        result["price_per_unit"] = float(m.group(1))

    m = _PCX_PER_100G_RE.search(sizing)
    if m:
        result["price_per_kg"] = round(float(m.group(1)) * 10, 2)

    m = _PCX_PER_100ML_RE.search(sizing)
    if m:
        result["price_per_L"] = round(float(m.group(1)) * 10, 2)

    m = _PCX_PER_KG_RE.search(sizing)
    if m:
        result["price_per_kg"] = float(m.group(1))

    m = _PCX_PER_LB_RE.search(sizing)
    if m:
        result["price_per_lb"] = float(m.group(1))

    return result


def parse_pcx_product(raw: Dict[str, Any], base_url: str = "") -> Dict[str, Any]:
    """Convert a raw PCX product object into a clean dict."""
    pricing = raw.get("pricing", {})
    deal = raw.get("deal")
    pricing_units = raw.get("pricingUnits", {})
    ratings = raw.get("ratings") or {}
    promotions = raw.get("promotions") or []
    images = raw.get("productImage") or [{}]

    sizing = raw.get("packageSizing", "")
    unit_prices = _parse_pcx_unit_prices(sizing)

    return {
        "product_id": raw.get("productId", ""),
        "article_number": raw.get("articleNumber", ""),
        "brand": raw.get("brand", ""),
        "title": raw.get("title", ""),
        "name": f"{raw.get('brand') or ''} {raw.get('title', '')}".strip(),
        "description": raw.get("description", ""),
        "price": pricing.get("price"),
        "display_price": pricing.get("displayPrice"),
        "was_price": pricing.get("wasPrice"),
        "member_only_price": pricing.get("memberOnlyPrice"),
        "package_sizing": sizing,
        "uom": raw.get("uom", ""),
        "pricing_unit": pricing_units.get("unit"),
        "pricing_unit_type": pricing_units.get("type"),
        "price_per_unit": unit_prices["price_per_unit"],
        "price_per_kg": unit_prices["price_per_kg"],
        "price_per_lb": unit_prices["price_per_lb"],
        "price_per_L": unit_prices["price_per_L"],
        "min_order_quantity": pricing_units.get("minOrderQuantity"),
        "max_order_quantity": pricing_units.get("maxOrderQuantity"),
        "weighted": pricing_units.get("weighted", False),
        "deal": deal.get("text") if deal else None,
        "promotions": [
            {"text": p.get("text", ""), "type": p.get("type", "")}
            for p in promotions if p.get("text")
        ],
        "average_rating": ratings.get("averageRating"),
        "review_count": ratings.get("reviewCount"),
        "image_url": images[0].get("mediumUrl", ""),
        "image_url_large": images[0].get("largeUrl", ""),
        "link": f"{base_url}{raw.get('link', '')}" if raw.get("link") and not raw.get("link", "").startswith("http") else raw.get("link", ""),
        "badge": raw.get("textBadge") or raw.get("productBadge") or None,
    }


async def _fetch_pcx_page(
    client: httpx.AsyncClient,
    search_url: str,
    query: str,
    page: int,
) -> List[Dict[str, Any]]:
    """Fetch a single page of PCX search results and return raw product objects."""
    params: Dict[str, str] = {"search-bar": query}
    if page > 1:
        params["page"] = str(page)

    resp = await client.get(
        search_url,
        params=params,
        headers={"User-Agent": _USER_AGENT},
    )
    resp.raise_for_status()

    match = _NEXT_DATA_RE.search(resp.text)
    if not match:
        return []
    return _extract_products_from_next_data(match.group(1))


async def fetch_pcx_prices(
    search_url: str,
    store_name: str,
    query: str,
    max_results: int = 50,
) -> Dict[str, Any]:
    """Fetch live shelf prices from a Loblaw PCX platform store.

    All Loblaw PCX stores use national online pricing — prices are the
    same across all locations, so no store ID is needed.

    Args:
        search_url: The store's search page URL.
        store_name: Display name for logging and responses.
        query: Search term (e.g. "chicken breast", "coffee").
        max_results: Maximum number of products to return. Defaults to 50
                     (single page). Set higher to fetch additional pages
                     (~48 products per page, up to ~288 max).

    Returns:
        Dict with status, store, products list, query, and result count.
    """
    log_id = f"[LivePricing:{store_name}]"
    log.info(f"{log_id} Searching for: {query} (max_results={max_results})")

    # Derive base URL (e.g. "https://www.loblaws.ca") from search_url
    from urllib.parse import urlparse
    parsed = urlparse(search_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    pages_needed = min(
        (max_results + _PRODUCTS_PER_PAGE - 1) // _PRODUCTS_PER_PAGE, _MAX_PAGES
    )

    try:
        seen_ids: set[str] = set()
        all_products: List[Dict[str, Any]] = []

        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            for page in range(1, pages_needed + 1):
                raw_products = await _fetch_pcx_page(client, search_url, query, page)
                if not raw_products:
                    break

                new_count = 0
                for raw in raw_products:
                    pid = raw.get("productId", "")
                    if pid in seen_ids:
                        continue
                    seen_ids.add(pid)
                    all_products.append(parse_pcx_product(raw, base_url))
                    new_count += 1

                    if len(all_products) >= max_results:
                        break

                if new_count == 0 or len(all_products) >= max_results:
                    break

        if not all_products:
            return {
                "status": "not_found",
                "message": f"No products found for '{query}' on {store_name}.",
                "store": store_name,
                "query": query,
            }

        log.info(f"{log_id} Found {len(all_products)} products for '{query}'")
        return {
            "status": "success",
            "store": store_name,
            "query": query,
            "result_count": len(all_products),
            "products": all_products,
        }

    except httpx.HTTPStatusError as e:
        log.error(f"{log_id} HTTP error: {e}", exc_info=True)
        return {
            "status": "error",
            "store": store_name,
            "message": f"{store_name} returned HTTP {e.response.status_code}",
        }
    except Exception as e:
        log.error(f"{log_id} Failed: {e}", exc_info=True)
        return {"status": "error", "store": store_name, "message": str(e)}
