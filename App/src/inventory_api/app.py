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
    lookup_barcode,
)
from src.shopper_agent.grocery_tools import check_local_flyers, find_best_deals_batch, find_nearby_stores

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
    expires_at: str | None = None


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


@app.get("/api/barcode/lookup")
async def barcode_lookup(
    code: str = Query(..., min_length=1, description="PLU (4-5 digit) or UPC (12-13 digit) barcode"),
) -> Dict[str, Any]:
    return await lookup_barcode(code)


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


async def _search_deals_with_category(
    q: str,
    postal_code: str,
    locale: str,
    lat: float,
    lng: float,
    limit: int,
    category: str | None = None,
) -> Dict[str, Any]:
    """Shared search logic used by all /api/flyer/search* endpoints."""
    result = await check_local_flyers(
        item_name=q,
        limit=limit,
        category=category,
        tool_config={"postal_code": postal_code, "locale": locale},
    )

    if result.get("status") != "success" or not result.get("deals"):
        return {"status": "success", "query": q, "found": False, "options": [], "store_locations": {}}

    # Collect store names and fetch nearby locations
    merchant_names = {deal["store"] for deal in result["deals"] if deal.get("store")}
    store_locations = {}
    if merchant_names:
        store_locations = await find_nearby_stores(list(merchant_names), lat, lng)

    return {
        "status": "success",
        "query": q,
        "found": True,
        "options": result["deals"],
        "store_locations": store_locations,
    }


@app.get("/api/flyer/search")
async def search_flyer_deals(
    q: str = Query(..., min_length=1, description="Item to search for"),
    postal_code: str = Query(default="K1A 0A6"),
    locale: str = Query(default="en-us"),
    lat: float = Query(default=45.4215),
    lng: float = Query(default=-75.6972),
    limit: int = Query(default=20, ge=1, le=100, description="Max number of deals to return"),
    category: str | None = Query(default=None, description="Filter by _L2 category: 'Food Items' or 'Beverages'"),
) -> Dict[str, Any]:
    """Search flyer deals for a single item by name."""
    return await _search_deals_with_category(q, postal_code, locale, lat, lng, limit, category)


@app.get("/api/flyer/search/food")
async def search_food_deals(
    q: str = Query(..., min_length=1, description="Item to search for"),
    postal_code: str = Query(default="K1A 0A6"),
    locale: str = Query(default="en-us"),
    lat: float = Query(default=45.4215),
    lng: float = Query(default=-75.6972),
    limit: int = Query(default=20, ge=1, le=100, description="Max number of deals to return"),
) -> Dict[str, Any]:
    """Search flyer deals filtered to Food Items only."""
    return await _search_deals_with_category(q, postal_code, locale, lat, lng, limit, category="Food Items")


@app.get("/api/flyer/search/beverages")
async def search_beverage_deals(
    q: str = Query(..., min_length=1, description="Item to search for"),
    postal_code: str = Query(default="K1A 0A6"),
    locale: str = Query(default="en-us"),
    lat: float = Query(default=45.4215),
    lng: float = Query(default=-75.6972),
    limit: int = Query(default=20, ge=1, le=100, description="Max number of deals to return"),
) -> Dict[str, Any]:
    """Search flyer deals filtered to Beverages only."""
    return await _search_deals_with_category(q, postal_code, locale, lat, lng, limit, category="Beverages")


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


# ── SAM Artifact proxy ──────────────────────────────────────────────────
# Reads artifacts saved by SAM agents from the filesystem.
# Path pattern: /tmp/samv2/{user}/{session_id}/{filename}/{version}

import json as _json
from fastapi.responses import JSONResponse

_ARTIFACT_BASE = Path(os.environ.get("SAM_ARTIFACT_BASE_PATH", "/tmp/samv2"))
_ARTIFACT_USER = os.environ.get("SAM_ARTIFACT_USER", "sam_dev_user")


@app.get("/api/artifacts/{session_id}/{filename}")
async def get_artifact(session_id: str, filename: str):
    """Read a SAM artifact from the filesystem.

    For pricing-products.json, tool calls may run in parallel so each
    store ends up in a separate version. This endpoint merges ALL versions
    into a single response with combined stores and products.
    """
    session_dir = _ARTIFACT_BASE / _ARTIFACT_USER / session_id / filename
    if not session_dir.is_dir():
        return JSONResponse({"error": "Artifact not found"}, status_code=404)

    version_nums = sorted(
        [int(f.name) for f in session_dir.iterdir() if f.name.isdigit()]
    )
    if not version_nums:
        return JSONResponse({"error": "No versions found"}, status_code=404)

    # If only one version, return it directly
    if len(version_nums) == 1:
        content = (session_dir / str(version_nums[0])).read_text(encoding="utf-8")
        try:
            return JSONResponse(_json.loads(content))
        except _json.JSONDecodeError:
            return JSONResponse({"raw": content})

    # Multiple versions: merge all stores, products, and keep latest ai_picks
    seen_stores = {}  # store_name -> store_info
    all_products = []
    ai_picks = None
    prompt = ""
    for v in version_nums:
        try:
            data = _json.loads((session_dir / str(v)).read_text(encoding="utf-8"))
        except (_json.JSONDecodeError, OSError):
            continue

        for s in data.get("stores", []):
            seen_stores[s["store"]] = s
        # Handle legacy single-store format
        if "store" in data and data["store"] not in seen_stores:
            seen_stores[data["store"]] = {
                "store": data["store"],
                "store_logo": data.get("store_logo", ""),
                "store_url": data.get("store_url", ""),
            }

        for p in data.get("products", []):
            all_products.append(p)

        # Keep the latest ai_picks and prompt (from submit_ai_picks)
        if data.get("ai_picks"):
            ai_picks = data["ai_picks"]
        if data.get("prompt"):
            prompt = data["prompt"]

    # Deduplicate products by (store, name, price)
    unique = {}
    for p in all_products:
        key = (p.get("store", ""), p.get("name", ""), p.get("price", ""))
        unique[key] = p

    result = {
        "stores": list(seen_stores.values()),
        "products": list(unique.values()),
    }
    if ai_picks:
        result["ai_picks"] = ai_picks
    if prompt:
        result["prompt"] = prompt
    return JSONResponse(result)
