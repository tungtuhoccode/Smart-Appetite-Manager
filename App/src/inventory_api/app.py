"""Read-only REST API for direct inventory list sync."""

from __future__ import annotations

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

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from src.inventory_agent.inventory_manager_tools import list_inventory_items


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


app = FastAPI(
    title="Smart Appetite Inventory API",
    description="Read-only REST API for inventory list sync (no token required).",
    version="1.0.0",
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
