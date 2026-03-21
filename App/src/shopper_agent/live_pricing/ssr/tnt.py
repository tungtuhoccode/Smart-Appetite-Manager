"""T&T Supermarket live pricing via Magento GraphQL API.

T&T uses a Magento PWA Studio frontend. Product search is done via
a public GraphQL endpoint at https://www.tntsupermarket.com/graphql.

Key custom fields discovered by intercepting frontend network requests:
  - was_price: original price before sale (0 = no sale)
  - uom_type: unit-of-measure type (2 = sold by weight)
  - weight_uom: unit label ("lb", "kg", etc.)
"""

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx

log = logging.getLogger(__name__)

_GRAPHQL_URL = "https://www.tntsupermarket.com/graphql"
_STORE_NAME = "T&T Supermarket"
_STORE_CODE = "default"
_BASE_URL = "https://www.tntsupermarket.com/eng"

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# T&T category IDs for filtering search results.
# Use these to narrow results to a specific department.
_CATEGORY_MAP: Dict[str, str] = {
    # Meat & Seafood
    "beef": "5051",
    "pork": "5052",
    "chicken": "5054",
    "poultry": "5054",
    "lamb": "5057",
    "venison": "5057",
    "fish": "5053",
    "seafood": "5053",
    "shrimp": "5053",
    "shellfish": "5058",
    "squid": "5058",
    "processed meat": "5056",
    "meat": "5036",           # All meat & seafood parent
    # Produce
    "vegetables": "5046",
    "fruits": "5047",
    "produce": "5035",        # All fruits & vegetables parent
    # Pantry
    "rice": "5003",
    "noodles": "5005",
    "instant noodles": "5006",
    "sauces": "5007",
    "oil": "5004",
    "canned food": "5009",
    "pantry": "4987",         # All pantry parent
    # Dairy & Frozen
    "eggs": "4990",
    "dairy": "4991",
    "milk": "4991",
    "tofu": "4992",
    "dumplings": "4993",
    "dim sum": "4994",
    "frozen": "4985",         # All dairy & frozen parent
    # Snacks & Drinks
    "chips": "5015",
    "candy": "5013",
    "cookies": "5012",
    "nuts": "5016",
    "drinks": "5018",
    "snacks": "4988",         # All snacks & drinks parent
    # Kitchen & Bakery
    "bakery": "5034",
    "bbq": "5039",
}

_SEARCH_QUERY = """
query ProductSearch(
  $currentPage: Int = 1
  $inputText: String!
  $pageSize: Int = 6
  $filters: ProductAttributeFilterInput!
  $sort: ProductAttributeSortInput
) {
  products(
    currentPage: $currentPage
    pageSize: $pageSize
    search: $inputText
    filter: $filters
    sort: $sort
  ) {
    items {
      id
      name
      sku
      price_range {
        minimum_price {
          final_price { currency value }
        }
      }
      was_price
      uom_type
      weight_uom
      small_image { url }
      stock_status
      url_key
      url_suffix
    }
    total_count
  }
}
"""


# Matches multiplier patterns like "5×120g", "355mLx12", "12x355mL"
_MULTI_RE = re.compile(
    r"(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(g|kg|lb|lbs|ml|mL|L)"
    r"|"
    r"(\d+(?:\.\d+)?)\s*(g|kg|lb|lbs|ml|mL|L)\s*[×xX]\s*(\d+)",
    re.IGNORECASE,
)

# Matches single size like "(454g)", "500mL", "2.5L", "15lbs", "4kg / 8.82lb"
_SIZE_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(g|kg|lb|lbs|ml|mL|L)\b",
    re.IGNORECASE,
)

# Normalize to grams or mL
_TO_GRAMS = {"g": 1, "kg": 1000, "lb": 453.592, "lbs": 453.592}
_TO_ML = {"ml": 1, "l": 1000}


def _parse_size_from_name(name: str) -> Tuple[Optional[float], Optional[str]]:
    """Extract total weight/volume from product name.

    Returns (total_amount_in_base_unit, unit_type) where unit_type is 'g' or 'mL',
    or (None, None) if no size found.
    """
    # Try multiplier pattern first: "5×120g" or "355mLx12"
    m = _MULTI_RE.search(name)
    if m:
        if m.group(1):  # "5×120g" format
            count = int(m.group(1))
            amount = float(m.group(2))
            unit = m.group(3)
        else:  # "355mLx12" format
            amount = float(m.group(4))
            unit = m.group(5)
            count = int(m.group(6))

        unit_lower = unit.lower()
        if unit_lower in _TO_GRAMS:
            return amount * count * _TO_GRAMS[unit_lower], "g"
        if unit_lower in _TO_ML:
            return amount * count * _TO_ML[unit_lower], "mL"

    # Try single size — take the first match
    matches = _SIZE_RE.findall(name)
    if matches:
        amount_str, unit = matches[0]
        amount = float(amount_str)
        unit_lower = unit.lower()
        if unit_lower in _TO_GRAMS:
            return amount * _TO_GRAMS[unit_lower], "g"
        if unit_lower in _TO_ML:
            return amount * _TO_ML[unit_lower], "mL"

    return None, None


def _compute_unit_price(price: float, total_base: float, unit_type: str) -> Tuple[str, str]:
    """Compute a human-friendly unit price string.

    Returns (unit_price_display, package_sizing).
    Weight → per 100g.  Volume → per 100mL.
    """
    if unit_type == "g":
        per_100g = price / total_base * 100
        if total_base >= 1000:
            sizing = f"{total_base / 1000:.2g}kg"
        else:
            sizing = f"{total_base:.0f}g"
        return f"${per_100g:.2f}/100g", sizing
    else:  # mL
        per_100ml = price / total_base * 100
        if total_base >= 1000:
            sizing = f"{total_base / 1000:.2g}L"
        else:
            sizing = f"{total_base:.0f}mL"
        return f"${per_100ml:.2f}/100mL", sizing


def _format_display_price(final_price: float, weight_uom: str | None) -> str:
    """Format price as '$12.99/lb' or '$2.49'."""
    price_str = f"${final_price:.2f}"
    if weight_uom:
        return f"{price_str}/{weight_uom}"
    return price_str


def _parse_tnt_product(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a raw TNT GraphQL product into the standard product dict."""
    min_price = raw.get("price_range", {}).get("minimum_price", {})
    final_price_obj = min_price.get("final_price", {})
    final_price = final_price_obj.get("value")

    weight_uom = raw.get("weight_uom") or ""
    uom_type = raw.get("uom_type")
    is_weighted = uom_type == 2

    was_price_raw = raw.get("was_price", 0)
    has_sale = was_price_raw and was_price_raw > 0

    display_price = _format_display_price(final_price, weight_uom if is_weighted else None) if final_price else None

    was_price_str = None
    deal = None
    if has_sale and final_price:
        was_price_str = _format_display_price(was_price_raw, weight_uom if is_weighted else None)
        pct = round((1 - final_price / was_price_raw) * 100)
        deal = f"Save {pct}%"

    url_key = raw.get("url_key", "")
    url_suffix = raw.get("url_suffix", ".html")
    link = f"{_BASE_URL}/{url_key}{url_suffix}" if url_key else ""

    img = raw.get("small_image", {}) or {}

    # For non-weighted items, parse size from name and compute unit price
    package_sizing = weight_uom if is_weighted else ""
    unit_price = None
    price_per_unit = None
    price_per_kg = None
    price_per_L = None
    name = raw.get("name", "")

    if is_weighted and final_price and weight_uom:
        # Weighted items: convert $/lb to $/kg or vice versa
        uom_lower = weight_uom.lower()
        if uom_lower == "lb":
            price_per_lb = final_price
            price_per_kg = round(final_price * 2.20462, 2)
        elif uom_lower == "kg":
            price_per_kg = final_price
    elif not is_weighted and final_price:
        total_base, unit_type = _parse_size_from_name(name)
        if total_base and total_base > 0:
            unit_price, package_sizing = _compute_unit_price(final_price, total_base, unit_type)
            if unit_type == "g":
                price_per_kg = round(final_price / total_base * 1000, 2)
            elif unit_type == "mL":
                price_per_L = round(final_price / total_base * 1000, 2)
        else:
            # Try countable pattern: "5 pcs", "12pcs", "(30pcs)"
            pcs_match = re.search(r"(\d+)\s*pcs\b", name, re.IGNORECASE)
            if pcs_match:
                count = int(pcs_match.group(1))
                if count > 0:
                    price_per_unit = round(final_price / count, 2)
                    package_sizing = f"{count} pcs"

    return {
        "product_id": str(raw.get("id", "")),
        "brand": "",
        "title": name,
        "name": name,
        "description": "",
        "price": final_price,
        "display_price": display_price,
        "was_price": was_price_str,
        "price_per_unit": price_per_unit,
        "price_per_kg": price_per_kg,
        "price_per_L": price_per_L,
        "package_sizing": package_sizing,
        "uom": weight_uom if is_weighted else "",
        "weighted": is_weighted,
        "deal": deal,
        "image_url": img.get("url", ""),
        "link": link,
    }


async def get_tnt_prices(
    query: str,
    category: str = "",
    max_results: int = 50,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Fetch live shelf prices from T&T Supermarket.

    Args:
        query: Search term (e.g. "chicken breast", "tofu").
        category: Optional category to filter results. Use this to narrow
            search to a specific department. Available categories:
              Meat & Seafood: "beef", "pork", "chicken", "poultry", "lamb",
                "venison", "fish", "seafood", "shrimp", "shellfish", "squid",
                "processed meat", "meat" (all meat & seafood)
              Produce: "vegetables", "fruits", "produce" (all produce)
              Pantry: "rice", "noodles", "instant noodles", "sauces", "oil",
                "canned food", "pantry" (all pantry)
              Dairy & Frozen: "eggs", "dairy", "milk", "tofu", "dumplings",
                "dim sum", "frozen" (all dairy & frozen)
              Snacks & Drinks: "chips", "candy", "cookies", "nuts", "drinks",
                "snacks" (all snacks & drinks)
              Kitchen & Bakery: "bakery", "bbq"
        max_results: Maximum number of products to return.
        tool_context: Agent tool context (unused, kept for consistency).
        tool_config: Optional config dict.

    Returns:
        Dict with status, store, products list, query, and result count.
    """
    log_id = f"[LivePricing:{_STORE_NAME}]"
    log.info(f"{log_id} Searching for: {query} (category={category!r}, max_results={max_results})")

    page_size = min(max_results, 35)

    filters: Dict[str, Any] = {}
    if category:
        cat_id = _CATEGORY_MAP.get(category.lower().strip())
        if cat_id:
            filters["category_id"] = {"eq": cat_id}
        else:
            log.warning(f"{log_id} Unknown category '{category}', searching without filter")

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                _GRAPHQL_URL,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": _USER_AGENT,
                    "Store": _STORE_CODE,
                },
                json={
                    "query": _SEARCH_QUERY,
                    "operationName": "ProductSearch",
                    "variables": {
                        "currentPage": 1,
                        "pageSize": page_size,
                        "filters": filters,
                        "inputText": query,
                        "sort": {"relevance": "DESC"},
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()

        errors = data.get("errors")
        if errors:
            msg = errors[0].get("message", "Unknown GraphQL error")
            log.error(f"{log_id} GraphQL error: {msg}")
            return {"status": "error", "store": _STORE_NAME, "query": query, "message": msg}

        items = data.get("data", {}).get("products", {}).get("items", [])

        if not items:
            return {
                "status": "not_found",
                "store": _STORE_NAME,
                "message": f"No products found for '{query}' on {_STORE_NAME}.",
                "query": query,
            }

        products = [_parse_tnt_product(item) for item in items[:max_results]]

        log.info(f"{log_id} Found {len(products)} products for '{query}'")
        return {
            "status": "success",
            "store": _STORE_NAME,
            "query": query,
            "result_count": len(products),
            "products": products,
        }

    except httpx.HTTPStatusError as e:
        log.error(f"{log_id} HTTP error: {e}", exc_info=True)
        return {
            "status": "error",
            "store": _STORE_NAME,
            "query": query,
            "message": f"{_STORE_NAME} returned HTTP {e.response.status_code}",
        }
    except Exception as e:
        log.error(f"{log_id} Failed: {e}", exc_info=True)
        return {"status": "error", "store": _STORE_NAME, "query": query, "message": str(e)}
