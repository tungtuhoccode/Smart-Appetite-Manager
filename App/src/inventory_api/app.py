"""Read-only REST API for direct inventory list sync."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if callable(load_dotenv):
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        load_dotenv()

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.inventory_agent.inventory_manager_tools import (
    list_inventory_items,
    insert_inventory_items,
    list_shopping_list_items,
    insert_shopping_list_items,
    toggle_shopping_list_item,
    delete_shopping_list_item,
    clear_checked_shopping_list_items,
)
from src.receipt_agent.receipt_scanner_tools import (
    scan_receipt_image_from_bytes,
    enrich_product_codes,
)
from src.shopper_agent.grocery_tools import find_best_deals_batch, find_nearby_stores

log = logging.getLogger(__name__)


def _db_path() -> str:
    return os.getenv("INVENTORY_MANAGER_DB_NAME", "inventory.db")


def _tool_config() -> Dict[str, Any]:
    return {"db_path": _db_path()}


def _ensure_read_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    if payload.get("status") == "success":
        return payload
    return {
        "status": "error",
        "operation": "read",
        "message": str(payload.get("message") or "Unknown inventory read error."),
        "user_message": str(
            payload.get("user_message")
            or payload.get("message")
            or "Inventory read failed."
        ),
        "count": 0,
        "rows": [],
    }


def _parse_allowed_origins() -> List[str]:
    raw = os.getenv(
        "INVENTORY_API_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _parse_allowed_origin_regex() -> str:
    return os.getenv(
        "INVENTORY_API_ALLOWED_ORIGIN_REGEX",
        r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$",
    )


def _llm_tool_config() -> Dict[str, Any]:
    return {
        "model_name": os.getenv("LLM_SERVICE_GENERAL_MODEL_NAME", "gpt-4o"),
        "api_base": os.getenv("LLM_SERVICE_ENDPOINT", ""),
        "api_key": os.getenv("LLM_SERVICE_API_KEY", ""),
    }


app = FastAPI(
    title="Smart Appetite Inventory API",
    description="REST API for inventory list sync, receipt scanning, and shopping list.",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_allowed_origins(),
    allow_origin_regex=_parse_allowed_origin_regex(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "inventory-rest-api"}


@app.get("/api/inventory/items")
async def get_inventory_items(
    limit: int = Query(default=200, ge=1, le=500),
) -> Dict[str, Any]:
    result = await list_inventory_items(limit=limit, tool_config=_tool_config())
    return _ensure_read_payload(result)


class InventoryItemInput(BaseModel):
    product_name: str
    quantity: float = 1
    quantity_unit: str | None = None
    unit: str | None = None
    category: str | None = None


class InventoryInsertRequest(BaseModel):
    items: list[InventoryItemInput]


@app.post("/api/inventory/items")
async def add_inventory_items(body: InventoryInsertRequest) -> Dict[str, Any]:
    items = [item.model_dump() for item in body.items]
    result = await insert_inventory_items(items=items, tool_config=_tool_config())
    return result


@app.post("/api/receipt/scan")
async def scan_receipt(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Upload a receipt image and extract grocery items via vision LLM."""
    image_bytes = await file.read()
    if not image_bytes:
        return {"status": "error", "message": "Empty file uploaded."}

    filename = file.filename or "receipt.jpg"
    llm_cfg = _llm_tool_config()

    scan_result = await scan_receipt_image_from_bytes(image_bytes, filename, llm_cfg)
    if scan_result.get("status") != "success" or not scan_result.get("items"):
        return scan_result

    enriched = await enrich_product_codes(scan_result["items"])
    return enriched


@app.get("/api/flyer/deals")
async def get_flyer_deals(
    postal_code: str = Query(default="K1A 0A6"),
    locale: str = Query(default="en-us"),
    lat: float = Query(default=45.4215),
    lng: float = Query(default=-75.6972),
) -> Dict[str, Any]:
    """Fetch flyer deals for all items currently in inventory."""
    inv = await list_inventory_items(limit=500, tool_config=_tool_config())
    if inv.get("status") != "success" or not inv.get("rows"):
        return {"status": "success", "summary": {}, "inventory": {}, "item_count": 0}

    # Build inventory lookup: product_name -> {quantity, quantity_unit, unit}
    inventory_info: Dict[str, Dict[str, Any]] = {}
    product_names: List[str] = []
    for row in inv["rows"]:
        name = row.get("product_name")
        if not name:
            continue
        if name not in inventory_info:
            product_names.append(name)
        inventory_info[name] = {
            "quantity": row.get("quantity", 0),
            "quantity_unit": row.get("quantity_unit", ""),
            "unit": row.get("unit", ""),
        }

    if not product_names:
        return {"status": "success", "summary": {}, "inventory": {}, "item_count": 0}

    result = await find_best_deals_batch(
        items=product_names,
        tool_config={"postal_code": postal_code, "locale": locale},
    )
    result["item_count"] = len(product_names)
    result["inventory"] = inventory_info

    # Fetch nearby store locations for all merchants found in deals
    merchant_names = set()
    summary = result.get("summary", {})
    for item_data in summary.values():
        for option in (item_data.get("options") or []):
            store = option.get("store")
            if store:
                merchant_names.add(store)

    if merchant_names:
        result["store_locations"] = await find_nearby_stores(
            list(merchant_names), lat, lng
        )
    else:
        result["store_locations"] = {}

    return result


# ---------------------------------------------------------------------------
# Shopping list endpoints
# ---------------------------------------------------------------------------


class ShoppingListItemInput(BaseModel):
    product_name: str
    quantity: float = 1
    quantity_unit: str | None = None
    unit: str | None = None
    category: str | None = None


class ShoppingListAddRequest(BaseModel):
    items: list[ShoppingListItemInput]


@app.get("/api/shopping-list/items")
async def get_shopping_list_items(
    limit: int = Query(default=200, ge=1, le=500),
) -> Dict[str, Any]:
    result = await list_shopping_list_items(limit=limit, tool_config=_tool_config())
    return _ensure_read_payload(result)


@app.post("/api/shopping-list/items")
async def add_shopping_list_items(body: ShoppingListAddRequest) -> Dict[str, Any]:
    items = [item.model_dump() for item in body.items]
    result = await insert_shopping_list_items(items=items, tool_config=_tool_config())
    return result


@app.patch("/api/shopping-list/items/{item_id}/toggle")
async def toggle_shopping_item(item_id: int) -> Dict[str, Any]:
    return await toggle_shopping_list_item(item_id=item_id, tool_config=_tool_config())


@app.delete("/api/shopping-list/items/{item_id}")
async def remove_shopping_item(item_id: int) -> Dict[str, Any]:
    return await delete_shopping_list_item(item_id=item_id, tool_config=_tool_config())


@app.delete("/api/shopping-list/checked")
async def clear_checked_items() -> Dict[str, Any]:
    return await clear_checked_shopping_list_items(tool_config=_tool_config())
