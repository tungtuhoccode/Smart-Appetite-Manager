"""
Receipt scanning tools — enhanced vision LLM + product code enrichment.

Single-pass approach using an enriched vision prompt with abbreviation dictionary,
few-shot examples, and food vs non-food classification. Research shows native image
processing with a well-crafted prompt outperforms OCR-then-interpret pipelines because
the vision model retains visual context (store name, department sections, layout).

Core functions (no SAM dependency):
  - scan_receipt_image_from_bytes: sends image to vision LLM, returns structured items
  - enrich_product_codes: PLU lookup + Open Food Facts + UPCitemdb

SAM tool wrapper:
  - scan_receipt_image: loads image from artifact service, delegates to core function
"""

import asyncio
import base64
import inspect
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Common PLU codes (4-5 digit produce codes)
# ---------------------------------------------------------------------------
PLU_TABLE: Dict[str, str] = {
    "3082": "Red Delicious Apple",
    "3283": "Honeycrisp Apple",
    "4011": "Banana",
    "4012": "Navel Orange",
    "4013": "Valencia Orange",
    "4017": "Granny Smith Apple",
    "4020": "Gold Delicious Apple",
    "4021": "Gala Apple",
    "4022": "Green Grapes",
    "4023": "Red Grapes",
    "4046": "Avocado (Small)",
    "4048": "Lime",
    "4050": "Cantaloupe",
    "4053": "Lemon",
    "4060": "Broccoli",
    "4061": "Green Beans",
    "4062": "Cucumber",
    "4063": "Yellow Squash",
    "4064": "Zucchini",
    "4065": "Green Bell Pepper",
    "4068": "Green Onion",
    "4069": "Green Cabbage",
    "4070": "Celery",
    "4071": "Corn",
    "4072": "Eggplant",
    "4073": "Iceberg Lettuce",
    "4074": "Romaine Lettuce",
    "4078": "Portabella Mushroom",
    "4080": "Russet Potato",
    "4081": "Red Potato",
    "4082": "Yukon Gold Potato",
    "4083": "Yellow Onion",
    "4084": "Red Onion",
    "4087": "Red Bell Pepper",
    "4088": "Sweet Potato",
    "4091": "Tomato",
    "4093": "Roma Tomato",
    "4225": "Honeydew Melon",
    "4231": "Mango",
    "4232": "Papaya",
    "4234": "Pineapple",
    "4235": "Nectarine",
    "4236": "White Peach",
    "4238": "Peach",
    "4240": "Plum (Black)",
    "4252": "Strawberries",
    "4299": "Pomegranate",
    "4381": "Garlic",
    "4608": "Sweet Onion",
    "4664": "Tomato on the Vine",
    "4665": "Grape Tomato",
    "4689": "Jalapeno Pepper",
    "4771": "Watermelon (Seedless)",
    "4958": "Blueberries",
    "4959": "Raspberries",
}

# ---------------------------------------------------------------------------
# Vision LLM receipt extraction prompt (single-pass with abbreviation decoding)
# ---------------------------------------------------------------------------
_RECEIPT_EXTRACTION_PROMPT = """\
You are an expert grocery receipt parser with deep knowledge of store-brand abbreviations, \
POS (point-of-sale) product codes, and food industry terminology.

Analyze this grocery receipt image. First, identify the STORE NAME from the header — this \
helps decode store-brand abbreviations. Then extract ALL purchased line items.

## Store Brand Abbreviations
- GV = Great Value (Walmart)
- KS = Kirkland Signature (Costco)
- MM = Member's Mark (Sam's Club)
- NF / NN = No Name / No Frills
- PC = President's Choice
- GLD HARV = Gold Harvest / Golden Harvest
- EQ = Equate (Walmart health/beauty)
- MS = Mainstays (Walmart housewares)
- TAL = Tal (Walmart drinkware brand)

## Common Receipt Abbreviations
Food: BNLS=Boneless, SKNLS=Skinless, CHK/CHKN=Chicken, BST/BRST=Breast, \
WHT=White, GRAN=Granulated, SUG=Sugar, BRN=Brown, WHL=Whole, MLK=Milk, \
GAL=Gallon, HG=Half Gallon, VEG=Vegetables, MIX=Mixed, FRZ=Frozen, ORG=Organic, \
FUSILL=Fusilli, SPAG=Spaghetti, PSTA=Pasta, RCE=Rice, SWT=Sweet, CRM=Cream, \
BTR=Butter, CHS=Cheese, BF=Beef, PRK=Pork, GRND=Ground, RSTD=Roasted, \
BRD=Bread, WW=Whole Wheat, TRTLA=Tortilla, LG=Large, SM=Small, MED=Medium

Non-food: ZPR=Zipper (bags), SANDW=Sandwich, SRVC/SRVNG=Serving, BWL=Bowl, \
PK=Pack, BNTY/BNTYSAS=Bounty Select-A-Size, CHRM/CHRMSF=Charmin Soft, \
TIDEHE=Tide HE, PAL=Palmolive, PUF=Puffs (tissues)

Numbers at the end = pack size: "4PK"=4-pack, "2PK"=2-pack, trailing digits often = count

## Output Schema
For each item return a JSON object:
- "product_name": Full, human-readable name WITHOUT weight/size suffixes. DECODE ALL abbreviations — never return raw POS codes. Do NOT embed weight in the name (e.g. use "Nutella Hazelnut Spread" not "Nutella Hazelnut Spread 725g").
- "quantity": The package weight/volume/count as a number. Priority order:
  1. If sold by weight (e.g. "1.5 kg @ $3.99/kg"), use the weight value → 1.5
  2. If a weight/size is printed on the receipt line (e.g. "725G", "500ML", "18OZ"), extract it → 725, 500, 18
  3. If a count multiplier is shown (e.g. "4 @"), use it → 4
  4. Default to 1 only if no weight/size/count is visible
- "quantity_unit": The unit matching the quantity. Use "g","kg","lb","oz","mL","L" for weight/volume. Use "unit" only when no weight/size is visible.
- "unit": Packaging type: "can","bottle","bag","box","jar","loaf","bunch","head","pack", or null
- "category": One of: Produce, Dairy, Meat, Seafood, Grains, Beverages, Snacks, Condiments, Frozen, Baking, Canned, Household, Non-Food, Other
- "is_food": true=edible (food/beverage/spice/cooking ingredient), false=non-food (cleaning, paper, kitchenware, bags, toiletries, clothing, storage, household)
- "product_code": UPC/barcode if visible (the 12-digit number), or null
- "price": Price as number (e.g. 3.99), or null

## Weight/Size Extraction Rules
- LOOK CAREFULLY at the receipt for weight/size indicators near each item: "725G", "500ML", "1KG", "18OZ", "1.5L", "675G", "250G", etc.
- These often appear as part of the abbreviated product name (e.g. "NUTELLA 725G") or on a separate description line
- Common weight abbreviations: G=grams, KG=kilograms, ML=milliliters, L=liters, OZ=ounces, LB=pounds, GAL=gallon
- For items sold by weight (meat, produce), the receipt usually shows "X.XX kg @ $Y.YY/kg" — extract the actual weight
- Do NOT put weight/size in the product_name field — it belongs in quantity + quantity_unit

## General Rules
- SKIP non-item lines: totals, subtotals, tax, payment, store header, date, change, discounts
- DECODE ALL abbreviations — use the store name, department context, price, and packaging clues
- Shopping bags, storage bags/containers, reusable bags → "Non-Food"
- Paper towels, toilet paper, tissues, detergent, soap, sponges → "Household"
- Kitchenware (bowls, boards, tumblers, sandals, clothing) → "Non-Food"

## Examples (receipt text → expected output)
- "NUTELLA 725G" → {"product_name":"Nutella Hazelnut Spread","quantity":725,"quantity_unit":"g","unit":"jar","category":"Condiments","is_food":true}
- "CHK BST BNLS 1.2KG" → {"product_name":"Chicken Breast Boneless","quantity":1.2,"quantity_unit":"kg","unit":"pack","category":"Meat","is_food":true}
- "WHT GRAN SUG 2KG" → {"product_name":"White Granulated Sugar","quantity":2,"quantity_unit":"kg","unit":"bag","category":"Baking","is_food":true}
- "GV GV FUSILL 375G" → {"product_name":"Great Value Fusilli Pasta","quantity":375,"quantity_unit":"g","unit":"box","category":"Grains","is_food":true}
- "GV Mix Veg 500G" → {"product_name":"Great Value Mixed Vegetables","quantity":500,"quantity_unit":"g","unit":"bag","category":"Frozen","is_food":true}
- "PALOMA 18OZ" → {"product_name":"Paloma Beverage","quantity":18,"quantity_unit":"oz","unit":"bottle","category":"Beverages","is_food":true}
- "GLD HARV 250G" → {"product_name":"Gold Harvest Peanuts","quantity":250,"quantity_unit":"g","unit":"bag","category":"Snacks","is_food":true}
- "GV White 675G" → {"product_name":"Great Value White Fish Fillets","quantity":675,"quantity_unit":"g","unit":"bag","category":"Frozen","is_food":true}
- "GV ZPR SANDW" → {"product_name":"Great Value Zipper Sandwich Bags","quantity":1,"quantity_unit":"unit","category":"Household","is_food":false}
- "Pears Bar" (qty 3) → {"product_name":"Pears Soap Bar","quantity":3,"quantity_unit":"unit","unit":"pack","category":"Household","is_food":false}
- "BNTYSAS2" → {"product_name":"Bounty Select-A-Size Paper Towels","quantity":1,"quantity_unit":"unit","category":"Household","is_food":false}
- "TIDEHE" → {"product_name":"Tide HE Laundry Detergent","quantity":1,"quantity_unit":"unit","category":"Household","is_food":false}
- "CHRMSF4" → {"product_name":"Charmin Soft Toilet Paper 4-Pack","quantity":1,"quantity_unit":"unit","category":"Household","is_food":false}
- "MS10X14BOARD" → {"product_name":"Mainstays 10x14 Cutting Board","quantity":1,"quantity_unit":"unit","category":"Non-Food","is_food":false}
- "Brown 18" → {"product_name":"Brown Bread","quantity":1,"quantity_unit":"loaf","unit":"loaf","category":"Grains","is_food":true}
- "Shopping Bag" → {"product_name":"Shopping Bag","quantity":1,"quantity_unit":"unit","category":"Non-Food","is_food":false}

Return ONLY a JSON array of item objects. No markdown, no explanation, no conversation.
"""


# ---------------------------------------------------------------------------
# Truncated JSON recovery
# ---------------------------------------------------------------------------
def _recover_truncated_json_array(text: str) -> Optional[List[Dict[str, Any]]]:
    """Attempt to recover complete items from a truncated JSON array.

    When max_tokens cuts the response mid-item, we find the last complete
    object in the array and parse everything up to that point.
    """
    # Find the last complete object boundary: "},\n  {" or "}\n]"
    last_complete = text.rfind("}")
    if last_complete == -1:
        return None
    # Try progressively shorter substrings ending at a "}"
    for i in range(last_complete, 0, -1):
        if text[i] != "}":
            continue
        candidate = text[:i + 1].rstrip().rstrip(",") + "\n]"
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list) and len(parsed) > 0:
                return parsed
        except json.JSONDecodeError:
            continue
    return None


# ---------------------------------------------------------------------------
# LLM call helper
# ---------------------------------------------------------------------------
async def _call_llm(
    messages: List[Dict[str, Any]],
    model: str,
    api_base: str,
    api_key: str,
    log_id: str,
    max_tokens: int = 4096,
    temperature: float = 0.1,
    timeout: float = 90.0,
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

    text = content.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        # Attempt to recover truncated JSON arrays (e.g., max_tokens cut off mid-item)
        recovered = _recover_truncated_json_array(text)
        if recovered is not None and len(recovered) > 0:
            log.warning(f"{log_id} JSON truncated, recovered {len(recovered)} complete items")
            return {"data": recovered}
        log.error(f"{log_id} JSON parse failed: {e}\nRaw: {text[:500]}")
        return {"error": f"Failed to parse LLM response: {e}", "raw": text[:1000]}

    return {"data": parsed}


# ---------------------------------------------------------------------------
# Core function: scan receipt image bytes (single-pass with enriched prompt)
# ---------------------------------------------------------------------------
async def scan_receipt_image_from_bytes(
    image_bytes: bytes,
    filename: str,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Send receipt image to vision LLM with enriched prompt. Returns structured items."""
    log_id = f"[ReceiptScanner:scan_from_bytes:{filename}]"
    log.info(f"{log_id} Starting ({len(image_bytes)} bytes)")

    cfg = tool_config or {}
    raw_model = cfg.get("model") or cfg.get("model_name") or os.getenv("LLM_SERVICE_IMAGE_MODEL_NAME") or os.getenv("LLM_SERVICE_GENERAL_MODEL_NAME", "gpt-4o")
    # SAM uses "openai/azure-gpt-4o" prefix for its own routing, but the
    # LiteLLM endpoint expects just "azure-gpt-4o". Strip the provider prefix.
    model = raw_model.split("/", 1)[-1] if "/" in raw_model else raw_model
    api_base = (cfg.get("api_base") or cfg.get("endpoint", "")).rstrip("/")
    api_key = cfg.get("api_key", "")

    if not api_base:
        return {"status": "error", "message": "No LLM API endpoint configured."}
    if not api_key:
        return {"status": "error", "message": "No LLM API key configured."}

    # Determine MIME type
    lower = filename.lower()
    if lower.endswith(".png"):
        mime = "image/png"
    elif lower.endswith((".jpg", ".jpeg")):
        mime = "image/jpeg"
    elif lower.endswith(".webp"):
        mime = "image/webp"
    else:
        mime = "image/jpeg"

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{mime};base64,{b64}"

    log.info(f"{log_id} Sending to vision LLM (model={model})")
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": _RECEIPT_EXTRACTION_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }
    ]
    result = await _call_llm(
        messages, model, api_base, api_key, log_id, max_tokens=16384, temperature=0.1
    )
    if "error" in result:
        return {"status": "error", "message": result["error"]}

    items = result["data"]
    if not isinstance(items, list):
        items = [items] if isinstance(items, dict) else []

    log.info(f"{log_id} Extracted {len(items)} items")
    return {"status": "success", "count": len(items), "items": items}


# ---------------------------------------------------------------------------
# Core function: enrich product codes via PLU / Open Food Facts / UPCitemdb
# ---------------------------------------------------------------------------
async def enrich_product_codes(
    items: List[Dict[str, Any]],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Enrich product names using PLU lookup and barcode APIs."""
    log_id = "[ReceiptScanner:enrich_product_codes]"
    log.info(f"{log_id} Enriching {len(items)} items")

    enriched = 0
    for item in items:
        code = str(item.get("product_code") or "").strip()
        if not code:
            continue

        # PLU codes: 4-5 digits
        if re.match(r"^\d{4,5}$", code):
            plu_name = PLU_TABLE.get(code)
            if plu_name:
                log.debug(f"{log_id} PLU {code} -> {plu_name}")
                item["product_name"] = plu_name
                enriched += 1
            continue

        # UPC codes: 12-13 digits
        if re.match(r"^\d{12,13}$", code):
            lookup = await _lookup_upc(code, log_id)
            if lookup:
                item["product_name"] = lookup["name"]
                # Apply package size if the vision LLM didn't already extract it
                if lookup.get("quantity_value") and item.get("quantity_unit", "unit") == "unit":
                    item["quantity"] = lookup["quantity_value"]
                    item["quantity_unit"] = lookup["quantity_unit"]
                enriched += 1

    log.info(f"{log_id} Enriched {enriched}/{len(items)} items")
    return {"status": "success", "count": len(items), "enriched": enriched, "items": items}


async def _lookup_upc(code: str, log_id: str) -> Optional[Dict[str, Any]]:
    """Look up a UPC code via Open Food Facts, then fallback to UPCitemdb.

    Returns a dict with 'name' and optionally 'quantity_value' + 'quantity_unit',
    or None if not found.
    """
    # Try both the raw code and zero-padded to 13 digits (EAN format)
    codes_to_try = [code]
    if len(code) == 12:
        codes_to_try.append("0" + code)
    elif len(code) == 13 and code.startswith("0"):
        codes_to_try.append(code[1:])

    # Try Open Food Facts first (free, no key)
    for upc in codes_to_try:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    f"https://world.openfoodfacts.org/api/v2/product/{upc}.json",
                    headers={"User-Agent": "SmartAppetiteManager/1.0"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("status") == 1:
                        product = data.get("product", {})
                        name = product.get("product_name") or product.get("product_name_en")
                        if name and len(name) > 1:
                            result: Dict[str, Any] = {"name": name}
                            # Extract package size from Open Food Facts
                            qty_str = product.get("quantity", "")
                            if qty_str:
                                parsed = _parse_quantity_string(qty_str)
                                if parsed:
                                    result["quantity_value"] = parsed[0]
                                    result["quantity_unit"] = parsed[1]
                            log.debug(f"{log_id} OFF {upc} -> {result}")
                            return result
        except Exception as e:
            log.debug(f"{log_id} OFF lookup failed for {upc}: {e}")

    # Fallback: UPCitemdb trial API (100/day, no key)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"https://api.upcitemdb.com/prod/trial/lookup?upc={code}",
                headers={"User-Agent": "SmartAppetiteManager/1.0"},
            )
            if resp.status_code == 200:
                data = resp.json()
                items_list = data.get("items", [])
                if items_list:
                    name = items_list[0].get("title")
                    if name and len(name) > 1:
                        log.debug(f"{log_id} UPCitemdb {code} -> {name}")
                        return {"name": name}
    except Exception as e:
        log.debug(f"{log_id} UPCitemdb lookup failed for {code}: {e}")

    return None


# Map of unit strings from Open Food Facts to our canonical units
_UNIT_MAP = {
    "g": "g", "gr": "g", "gram": "g", "grams": "g",
    "kg": "kg", "kilogram": "kg", "kilograms": "kg",
    "ml": "mL", "milliliter": "mL", "milliliters": "mL", "millilitres": "mL",
    "cl": "mL",  # centiliters → we'll multiply by 10
    "l": "L", "liter": "L", "liters": "L", "litre": "L", "litres": "L",
    "oz": "oz", "ounce": "oz", "ounces": "oz", "fl oz": "oz",
    "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
}


def _parse_quantity_string(qty_str: str) -> Optional[tuple]:
    """Parse a quantity string like '725 g', '500 ml', '1.5 L' into (value, unit).

    Returns (numeric_value, canonical_unit) or None if unparseable.
    """
    qty_str = qty_str.strip().lower()
    # Match patterns like "725 g", "1.5 kg", "500ml", "18 fl oz"
    m = re.match(r"^(\d+(?:[.,]\d+)?)\s*(fl\s*oz|[a-z]+)", qty_str)
    if not m:
        return None
    value_str = m.group(1).replace(",", ".")
    unit_str = m.group(2).strip()
    try:
        value = float(value_str)
    except ValueError:
        return None
    canonical = _UNIT_MAP.get(unit_str)
    if not canonical:
        return None
    # Convert centiliters to mL
    if unit_str == "cl":
        value = value * 10
    return (value, canonical)


# ---------------------------------------------------------------------------
# SAM tool wrapper: load image from artifact service, then scan
# ---------------------------------------------------------------------------
async def scan_receipt_image(
    image_filename: str,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Scan a receipt image uploaded to the chat. Returns structured inventory items."""
    log_id = f"[ReceiptScanner:scan_receipt_image:{image_filename}]"
    log.info(f"{log_id} Loading image artifact")

    if not tool_context:
        return {"status": "error", "message": "No tool_context provided."}

    try:
        from solace_agent_mesh.agent.utils.context_helpers import get_original_session_id

        inv_context = tool_context._invocation_context
        if not inv_context:
            raise ValueError("InvocationContext is not available.")

        app_name = getattr(inv_context, "app_name", None)
        user_id = getattr(inv_context, "user_id", None)
        session_id = get_original_session_id(inv_context)
        artifact_service = getattr(inv_context, "artifact_service", None)

        if not all([app_name, user_id, session_id, artifact_service]):
            missing = [
                p for p, v in [
                    ("app_name", app_name),
                    ("user_id", user_id),
                    ("session_id", session_id),
                    ("artifact_service", artifact_service),
                ] if not v
            ]
            raise ValueError(f"Missing context: {', '.join(missing)}")

        # Parse optional version from filename (e.g. "receipt.jpg:1")
        parts = image_filename.rsplit(":", 1)
        fname = parts[0]
        version_to_load = int(parts[1]) if len(parts) > 1 else None

        # Get latest version if not specified
        if version_to_load is None:
            list_versions_method = getattr(artifact_service, "list_versions")
            if inspect.iscoroutinefunction(list_versions_method):
                versions = await list_versions_method(
                    app_name=app_name, user_id=user_id,
                    session_id=session_id, filename=fname,
                )
            else:
                versions = await asyncio.to_thread(
                    list_versions_method,
                    app_name=app_name, user_id=user_id,
                    session_id=session_id, filename=fname,
                )
            if not versions:
                raise FileNotFoundError(f"Image artifact '{fname}' not found.")
            version_to_load = max(versions)

        # Load artifact
        load_method = getattr(artifact_service, "load_artifact")
        if inspect.iscoroutinefunction(load_method):
            artifact_part = await load_method(
                app_name=app_name, user_id=user_id,
                session_id=session_id, filename=fname, version=version_to_load,
            )
        else:
            artifact_part = await asyncio.to_thread(
                load_method,
                app_name=app_name, user_id=user_id,
                session_id=session_id, filename=fname, version=version_to_load,
            )

        if not artifact_part or not artifact_part.inline_data:
            raise FileNotFoundError(f"Content for '{fname}' v{version_to_load} not found.")

        image_bytes = artifact_part.inline_data.data
        log.info(f"{log_id} Loaded {len(image_bytes)} bytes")

    except Exception as e:
        log.error(f"{log_id} Failed to load artifact: {e}", exc_info=True)
        return {"status": "error", "message": f"Failed to load receipt image: {e}"}

    return await scan_receipt_image_from_bytes(image_bytes, fname, tool_config)
