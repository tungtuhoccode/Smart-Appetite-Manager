import logging
import re
from typing import Any, Dict, List, Optional

from ._playwright_base import headless_page

log = logging.getLogger(__name__)

_SEARCH_URL = "https://www.metro.ca/en/online-grocery/search"
_PRODUCT_URL = "https://www.metro.ca/en/online-grocery/product/{product_id}"
_STORE_NAME = "Metro"

_JS_EXTRACT = """
() => {
    var tiles = document.querySelectorAll('[data-product-code]');
    var results = [];
    for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        var pricingEl = t.querySelector('.pricing, [class*="pricing"]');
        var pricingText = pricingEl ? pricingEl.innerText.trim() : '';
        var imgEl = t.querySelector('.defaultable-picture img') || t.querySelector('img[srcset]');
        var imgSrc = '';
        if (imgEl) {
            var srcset = imgEl.getAttribute('srcset') || '';
            imgSrc = srcset ? srcset.split(',')[0].trim().split(' ')[0] : (imgEl.getAttribute('src') || '');
        }
        var sizingEl = t.querySelector('.head__unit-details');
        var sizingText = sizingEl ? sizingEl.innerText.trim() : '';
        var unitPriceEl = t.querySelector('.pricing__secondary-price');
        var unitPriceText = unitPriceEl ? unitPriceEl.innerText.trim() : '';
        var mainPriceEl = pricingEl ? pricingEl.querySelector('[data-main-price]') : null;
        var mainPrice = mainPriceEl ? mainPriceEl.getAttribute('data-main-price') : '';
        results.push({
            code: t.dataset.productCode || '',
            name: t.dataset.productName || '',
            nameEn: t.dataset.productNameEn || '',
            brand: t.dataset.productBrand || '',
            category: t.dataset.productCategory || '',
            categoryEn: t.dataset.productCategoryEn || '',
            categoryUrl: t.dataset.categoryUrl || '',
            isWeighted: t.dataset.isWeighted || 'false',
            minQty: t.dataset.minQty || '',
            maxQty: t.dataset.maxQty || '',
            pricingText: pricingText,
            packageSizing: sizingText,
            unitPriceText: unitPriceText,
            mainPrice: mainPrice,
            imageUrl: imgSrc,
        });
    }
    return results;
}
"""

# Matches "$21.58 /kg" or "$9.79 /lb." or "$9.79/lb"
_PRICE_UNIT_RE = re.compile(
    r"\$(\d+\.?\d*)\s*/\s*(kg|lb|100\s*g)\.?", re.IGNORECASE
)
# Matches "$0.33 /un." or "$0.33/un"
_UNIT_PRICE_RE = re.compile(
    r"\$(\d+\.?\d*)\s*/\s*(un|unit)\.?", re.IGNORECASE
)
# Matches "$23.22" standalone (avg ea price)
_FLAT_PRICE_RE = re.compile(r"\$(\d+\.?\d*)")


def _parse_metro_pricing(pricing_text: str, unit_price_text: str = "") -> Dict[str, Any]:
    """Parse Metro's pricing text into structured fields."""
    result: Dict[str, Any] = {
        "display_price": None,
        "price_per_kg": None,
        "price_per_lb": None,
        "price_per_unit": None,
        "is_avg_price": False,
    }
    if not pricing_text:
        return result

    # Check for per-unit pricing (e.g. "$0.33 /un.")
    # Prefer unit_price_text (from secondary-price element) over main pricing text
    unit_source = unit_price_text or pricing_text
    unit_match = _UNIT_PRICE_RE.search(unit_source)
    if unit_match:
        result["price_per_unit"] = float(unit_match.group(1))

    unit_matches = _PRICE_UNIT_RE.findall(pricing_text)
    for price_str, unit in unit_matches:
        price = float(price_str)
        unit_lower = unit.lower().replace(" ", "")
        if unit_lower == "kg":
            result["price_per_kg"] = price
            result["display_price"] = f"${price_str}/kg"
        elif unit_lower == "lb":
            result["price_per_lb"] = price
        elif unit_lower == "100g":
            result["price_per_kg"] = round(price * 10, 2)
            result["display_price"] = f"${price_str}/100g"

    if not unit_matches:
        flat = _FLAT_PRICE_RE.search(pricing_text)
        if flat:
            result["display_price"] = f"${flat.group(1)}"
            if "avg" in pricing_text.lower():
                result["is_avg_price"] = True

    return result


# Matches volume sizing like "4 L", "2 L", "1.5 L", "500 mL", "750 ml"
_VOLUME_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(L|mL|ml|l)\b", re.IGNORECASE)


def _compute_price_per_litre(display_price: str | None, sizing: str) -> float | None:
    """Derive $/L from a flat price and volume sizing (e.g. '$7.19' + '4 L')."""
    if not display_price or not sizing:
        return None
    price_match = _FLAT_PRICE_RE.search(display_price)
    vol_match = _VOLUME_RE.search(sizing)
    if not price_match or not vol_match:
        return None
    price = float(price_match.group(1))
    volume = float(vol_match.group(1))
    unit = vol_match.group(2).lower()
    if unit in ("ml",):
        volume /= 1000.0
    if volume <= 0:
        return None
    return round(price / volume, 2)


def _parse_metro_product(raw: Dict[str, Any], product_url_template: str = "") -> Dict[str, Any]:
    """Convert a raw Metro DOM product into a clean dict."""
    pricing = _parse_metro_pricing(raw.get("pricingText", ""), raw.get("unitPriceText", ""))
    product_id = raw.get("code", "")
    tmpl = product_url_template or _PRODUCT_URL
    link = tmpl.format(product_id=product_id) if product_id else ""

    sizing = raw.get("packageSizing", "")
    price_per_L = None
    # Compute $/L when the site gives a flat price + volume sizing but no per-weight price
    if not pricing.get("price_per_kg") and not pricing.get("price_per_unit"):
        price_per_L = _compute_price_per_litre(pricing.get("display_price"), sizing)

    return {
        "product_id": product_id,
        "brand": raw.get("brand", ""),
        "title": raw.get("name") or raw.get("nameEn", ""),
        "name": raw.get("name") or raw.get("nameEn", ""),
        "description": "",
        "price": pricing.get("display_price"),
        "display_price": pricing.get("display_price"),
        "was_price": None,
        "price_per_kg": pricing.get("price_per_kg"),
        "price_per_lb": pricing.get("price_per_lb"),
        "price_per_unit": pricing.get("price_per_unit"),
        "price_per_L": price_per_L,
        "is_avg_price": pricing.get("is_avg_price", False),
        "package_sizing": sizing,
        "category": raw.get("category") or raw.get("categoryEn", ""),
        "weighted": raw.get("isWeighted", "false").lower() == "true",
        "deal": None,
        "image_url": raw.get("imageUrl", ""),
        "link": link,
    }


async def get_metro_prices(
    query: str,
    max_results: int = 50,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Fetch live shelf prices from Metro using headless Playwright.

    Args:
        query: Search term (e.g. "chicken breast", "coffee").
        max_results: Maximum number of products to return.
        tool_context: Agent tool context (unused, kept for consistency).
        tool_config: Optional config dict.

    Returns:
        Dict with status, store, products list, query, and result count.
    """
    log_id = f"[LivePricing:{_STORE_NAME}]"
    log.info(f"{log_id} Searching for: {query}")

    try:
        async with headless_page(timeout=25000) as page:
            await page.goto(
                f"{_SEARCH_URL}?filter={query}",
                wait_until="domcontentloaded",
            )
            await page.wait_for_timeout(5000)

            raw_products: List[Dict[str, Any]] = await page.evaluate(_JS_EXTRACT)

        if not raw_products:
            return {
                "status": "not_found",
                "store": _STORE_NAME,
                "message": f"No products found for '{query}' on {_STORE_NAME}.",
                "query": query,
            }

        products = [_parse_metro_product(p) for p in raw_products[:max_results]]

        log.info(f"{log_id} Found {len(products)} products for '{query}'")
        return {
            "status": "success",
            "store": _STORE_NAME,
            "query": query,
            "result_count": len(products),
            "products": products,
        }

    except Exception as e:
        log.error(f"{log_id} Failed: {e}", exc_info=True)
        return {"status": "error", "store": _STORE_NAME, "message": str(e)}
