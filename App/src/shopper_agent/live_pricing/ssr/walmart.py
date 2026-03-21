import json
import logging
import os
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

import httpx

log = logging.getLogger(__name__)

_STORE_NAME = "Walmart"
_SCRAPER_API_URL = "https://api.scraperapi.com"
_WALMART_SEARCH_URL = "https://www.walmart.ca/search"

# Regex accounts for optional nonce attribute on the script tag
_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
    re.DOTALL,
)


def _get_api_key() -> str:
    key = os.environ.get("SCRAPER_API_KEY", "")
    if not key:
        raise RuntimeError(
            "SCRAPER_API_KEY environment variable is not set. "
            "Get a free key at https://www.scraperapi.com/signup"
        )
    return key


def _parse_price_str(text: str) -> Optional[float]:
    """Extract a numeric price from text like '$12.97'."""
    if not text:
        return None
    match = re.search(r"\$?([\d,]+\.?\d*)", text.replace(",", ""))
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def _extract_items_from_next_data(html: str) -> List[Dict[str, Any]]:
    """Extract product items from the __NEXT_DATA__ JSON.

    Path: props.pageProps.initialData.searchResult.itemStacks[0].items
    Each item has __typename "Product" with priceInfo, imageInfo, etc.
    """
    match = _NEXT_DATA_RE.search(html)
    if not match:
        return []

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []

    try:
        stacks = (
            data["props"]["pageProps"]["initialData"]["searchResult"]["itemStacks"]
        )
        items = []
        for stack in stacks:
            for item in stack.get("items", []):
                if item.get("__typename") == "Product":
                    items.append(item)
        return items
    except (KeyError, TypeError, IndexError):
        return []


def _parse_product(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a Walmart.ca __NEXT_DATA__ product into the standard format.

    Known fields from Walmart.ca's Next.js payload:
        priceInfo.linePrice        -> "$8.47"
        priceInfo.unitPrice        -> "$1.41/100g"
        priceInfo.wasPrice         -> "$10.97" (empty string if no sale)
        priceInfo.savings          -> "Save $2.50" (empty string if none)
        priceInfo.memberPriceString -> Walmart+ member price
        imageInfo.thumbnailUrl     -> image URL
        canonicalUrl               -> "/en/ip/Product-Name/ID"
        name, brand, salesUnit, shortDescription
    """
    name = raw.get("name") or ""
    brand = raw.get("brand") or ""

    price_info = raw.get("priceInfo") or {}
    line_price = price_info.get("linePrice") or price_info.get("linePriceDisplay") or ""
    price = _parse_price_str(line_price)
    display_price = line_price or None

    was_price = price_info.get("wasPrice") or None
    if was_price == "":
        was_price = None

    unit_price = price_info.get("unitPrice") or ""
    savings = price_info.get("savings") or ""
    member_price = price_info.get("memberPriceString") or None
    if member_price == "":
        member_price = None

    # Deal text from savings
    deal = savings if savings else None

    # Image
    image_info = raw.get("imageInfo") or {}
    image_url = image_info.get("thumbnailUrl") or ""

    # Link
    canonical = raw.get("canonicalUrl") or ""
    link = f"https://www.walmart.ca{canonical}" if canonical else ""

    # Parse unit price string (e.g. "$1.41/100g", "$0.58/ea", "$8.80/kg")
    uom = raw.get("salesUnit") or ""
    price_per_kg = None
    price_per_unit = None
    price_per_L = None
    if unit_price:
        up_match = re.search(r"\$(\d+\.?\d*)\s*/\s*(100g|kg|lb|ea|100mL|L)", unit_price, re.IGNORECASE)
        if up_match:
            up_val = float(up_match.group(1))
            up_unit = up_match.group(2).lower()
            if up_unit == "100g":
                price_per_kg = round(up_val * 10, 2)
            elif up_unit == "kg":
                price_per_kg = up_val
            elif up_unit == "ea":
                price_per_unit = up_val
            elif up_unit == "100ml":
                price_per_L = round(up_val * 10, 2)
            elif up_unit == "l":
                price_per_L = up_val

    package_sizing = unit_price or ""

    return {
        "product_id": str(raw.get("usItemId") or raw.get("id") or ""),
        "brand": brand,
        "title": name,
        "name": f"{brand} {name}".strip() if brand and brand.lower() not in name.lower() else name,
        "description": raw.get("shortDescription") or "",
        "price": price,
        "display_price": display_price,
        "was_price": was_price,
        "member_only_price": member_price,
        "package_sizing": package_sizing,
        "uom": uom,
        "price_per_kg": price_per_kg,
        "price_per_unit": price_per_unit,
        "price_per_L": price_per_L,
        "deal": deal,
        "average_rating": raw.get("averageRating"),
        "review_count": raw.get("numberOfReviews"),
        "image_url": image_url,
        "link": link,
    }


async def get_walmart_prices(
    query: str,
    max_results: int = 50,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Fetch live shelf prices from Walmart.ca via ScraperAPI.

    Args:
        query: Search term (e.g. "chicken breast", "eggs").
        max_results: Maximum number of products to return.
        tool_context: Agent tool context (unused, kept for consistency).
        tool_config: Optional config dict (can contain scraper_api_key).

    Returns:
        Dict with status, store, products list, query, and result count.
    """
    log_id = f"[LivePricing:{_STORE_NAME}]"
    log.info(f"{log_id} Searching for: {query} (max_results={max_results})")

    api_key = None
    if tool_config:
        api_key = tool_config.get("scraper_api_key")
    if not api_key:
        try:
            api_key = _get_api_key()
        except RuntimeError as e:
            return {"status": "error", "store": _STORE_NAME, "query": query, "message": str(e)}

    target_url = f"{_WALMART_SEARCH_URL}?q={quote_plus(query)}"

    # No render=true needed — Walmart.ca returns __NEXT_DATA__ in SSR HTML
    params = {
        "api_key": api_key,
        "url": target_url,
    }

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            log.debug(f"{log_id} Fetching via ScraperAPI: {target_url}")
            resp = await client.get(_SCRAPER_API_URL, params=params)
            resp.raise_for_status()
            html = resp.text

        log.debug(f"{log_id} Got {len(html)} bytes of HTML")

        raw_items = _extract_items_from_next_data(html)
        if not raw_items:
            return {
                "status": "not_found",
                "store": _STORE_NAME,
                "query": query,
                "message": f"No products found for '{query}' on {_STORE_NAME}. "
                           "The page structure may have changed.",
            }

        products = [_parse_product(item) for item in raw_items[:max_results]]
        # Filter out items with no price (ads, placeholders)
        products = [p for p in products if p.get("price") is not None]

        if not products:
            return {
                "status": "not_found",
                "store": _STORE_NAME,
                "query": query,
                "message": f"No priced products found for '{query}' on {_STORE_NAME}.",
            }

        log.info(f"{log_id} Found {len(products)} products for '{query}'")
        return {
            "status": "success",
            "store": _STORE_NAME,
            "query": query,
            "result_count": len(products),
            "products": products,
        }

    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        msg = f"ScraperAPI returned HTTP {status}"
        if status == 401:
            msg = "Invalid SCRAPER_API_KEY. Check your API key."
        elif status == 403:
            msg = "ScraperAPI access denied. Check your plan/credits."
        elif status == 429:
            msg = "ScraperAPI rate limit reached. Try again later."
        log.error(f"{log_id} {msg}", exc_info=True)
        return {"status": "error", "store": _STORE_NAME, "query": query, "message": msg}
    except httpx.TimeoutException:
        log.error(f"{log_id} Request timed out (90s)")
        return {
            "status": "error",
            "store": _STORE_NAME,
            "query": query,
            "message": "Request timed out. Walmart.ca may be slow or ScraperAPI is overloaded.",
        }
    except Exception as e:
        log.error(f"{log_id} Failed: {e}", exc_info=True)
        return {"status": "error", "store": _STORE_NAME, "query": query, "message": str(e)}
