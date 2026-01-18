"""
Receipt parsing tools for SAM agents.

Parses OCR text into structured inventory items.
"""

import logging
import re
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

_SKIP_KEYWORDS = (
    "total",
    "subtotal",
    "tax",
    "change",
    "balance",
    "cash",
    "credit",
    "debit",
    "visa",
    "mastercard",
    "amex",
    "payment",
    "card",
)

_PACK_WORDS = (
    "family pack",
    "pack",
    "box",
    "bag",
    "bottle",
    "dozen",
    "loaf",
    "head",
    "tub",
    "can",
    "jar",
)


def _should_skip(line: str) -> bool:
    lower = line.lower()
    return any(word in lower for word in _SKIP_KEYWORDS)


def _extract_weight(line: str) -> Optional[Dict[str, Any]]:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(kg|g)\b", line, re.IGNORECASE)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).lower()
    grams = value * 1000 if unit == "kg" else value
    return {
        "quantity": int(grams) if grams.is_integer() else grams,
        "quantity_unit": "g",
        "match": match.group(0),
    }


def _extract_volume(line: str) -> Optional[Dict[str, Any]]:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(l|ml)\b", line, re.IGNORECASE)
    if not match:
        return None
    value = match.group(1)
    unit = match.group(2).lower()
    return {
        "quantity": 1,
        "quantity_unit": "unit",
        "unit": f"{value}{unit}",
        "match": match.group(0),
    }


def _extract_count(line: str) -> Optional[Dict[str, Any]]:
    match = re.match(r"^\s*(\d+)\s+(.*)$", line)
    if match:
        return {"quantity": int(match.group(1)), "match": match.group(0), "rest": match.group(2)}
    match = re.search(r"\b(\d+)\s*(x|ct|pcs|pc|each|ea)\b", line, re.IGNORECASE)
    if match:
        return {"quantity": int(match.group(1)), "match": match.group(0)}
    return None


def _extract_pack_unit(line: str) -> Optional[str]:
    lower = line.lower()
    for word in _PACK_WORDS:
        if word in lower:
            return word
    return None


async def parse_receipt_text(
    text: str,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Parse OCR receipt text into inventory items.

    Returns a list of items with: product_name, quantity, quantity_unit, unit.
    """
    log_id = "[ReceiptTools:parse_receipt_text]"
    if not text or not text.strip():
        return {"status": "error", "message": "No receipt text provided."}

    items: List[Dict[str, Any]] = []
    skipped: List[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _should_skip(line):
            skipped.append(line)
            continue

        working = line
        quantity = 1
        quantity_unit = "unit"
        unit: Optional[str] = None

        weight = _extract_weight(working)
        if weight:
            quantity = weight["quantity"]
            quantity_unit = weight["quantity_unit"]
            working = working.replace(weight["match"], " ")
        else:
            volume = _extract_volume(working)
            if volume:
                quantity = volume["quantity"]
                quantity_unit = volume["quantity_unit"]
                unit = volume.get("unit")
                working = working.replace(volume["match"], " ")

        count = _extract_count(working)
        if count and quantity_unit == "unit":
            quantity = count["quantity"]
            if "rest" in count:
                working = count["rest"]
            else:
                working = working.replace(count["match"], " ")

        if not unit:
            pack_unit = _extract_pack_unit(working)
            if pack_unit:
                unit = pack_unit
                working = working.replace(pack_unit, " ")

        product_name = re.sub(r"\s+", " ", working).strip(" -")
        if not product_name:
            skipped.append(line)
            continue

        items.append(
            {
                "product_name": product_name.title(),
                "quantity": quantity,
                "quantity_unit": quantity_unit,
                "unit": unit,
            }
        )

    log.info(f"{log_id} Parsed {len(items)} items (skipped {len(skipped)})")
    return {"status": "success", "count": len(items), "items": items, "skipped": skipped}
