"""
Inventory manager tools for SAM agents.

Provides basic read/insert operations against a SQLite inventory database.
"""

import json
import logging
import os
import re
import sqlite3
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple


log = logging.getLogger(__name__)

VALID_CATEGORIES = {
    "Produce", "Dairy", "Meat", "Seafood", "Grains", "Beverages",
    "Snacks", "Condiments", "Frozen", "Baking", "Canned", "Other",
}

# Volume units → mL
_ML_PER_UNIT: Dict[str, float] = {
    "ml": 1, "l": 1000, "tsp": 4.929, "teaspoon": 4.929, "teaspoons": 4.929,
    "tbsp": 14.787, "tablespoon": 14.787, "tablespoons": 14.787,
    "cup": 236.588, "cups": 236.588, "fl oz": 29.574,
    "pint": 473.176, "quart": 946.353, "gallon": 3785.41,
}

# Weight units → grams
_G_PER_UNIT: Dict[str, float] = {
    "g": 1, "gram": 1, "grams": 1, "mg": 0.001, "kg": 1000,
    "oz": 28.35, "ounce": 28.35, "ounces": 28.35,
    "lb": 453.592, "lbs": 453.592, "pound": 453.592, "pounds": 453.592,
}

# Ingredient-specific unit conversions: {keyword: {from_unit: (to_unit, factor)}}
INGREDIENT_CONVERSIONS: Dict[str, Dict[str, tuple]] = {
    "garlic":   {"head": ("tbsp", 3.0),   "bulb": ("tbsp", 3.0),   "clove": ("tsp", 0.5)},
    "onion":    {"head": ("g", 150.0),    "unit": ("g", 150.0),    "medium": ("g", 150.0), "large": ("g", 220.0)},
    "broccoli": {"head": ("g", 350.0),    "unit": ("g", 350.0),    "crown": ("g", 200.0)},
    "butter":   {"stick": ("g", 113.4),   "cube": ("g", 113.4)},
    "lemon":    {"unit": ("tbsp", 3.0),   "whole": ("tbsp", 3.0)},
    "lime":     {"unit": ("tbsp", 2.0),   "whole": ("tbsp", 2.0)},
    "banana":   {"unit": ("g", 118.0),    "medium": ("g", 118.0),  "large": ("g", 136.0)},
    "egg":      {"unit": ("g", 50.0),     "large": ("g", 50.0),    "medium": ("g", 44.0)},
    "carrot":   {"unit": ("g", 61.0),     "medium": ("g", 61.0),   "large": ("g", 80.0)},
    "potato":   {"unit": ("g", 150.0),    "medium": ("g", 150.0),  "large": ("g", 250.0), "small": ("g", 100.0)},
    "tomato":   {"unit": ("g", 123.0),    "medium": ("g", 123.0),  "large": ("g", 180.0)},
    "avocado":  {"unit": ("g", 136.0),    "medium": ("g", 136.0)},
    "apple":    {"unit": ("g", 182.0),    "medium": ("g", 182.0)},
}

_DEFAULT_SHELF_LIFE_DAYS: Dict[str, int] = {
    "Produce": 5, "Dairy": 7, "Meat": 3, "Seafood": 2,
    "Grains": 180, "Beverages": 30, "Snacks": 90,
    "Condiments": 180, "Frozen": 90, "Baking": 365,
    "Canned": 365, "Other": 30,
}


def _estimate_expiry(category: Optional[str]) -> str:
    days = _DEFAULT_SHELF_LIFE_DAYS.get(category or "Other", 30)
    return (date.today() + timedelta(days=days)).isoformat()


_DEFAULT_DB_PATH = os.getenv("INVENTORY_MANAGER_DB_NAME", "inventory.db")


def _get_db_path(tool_config: Optional[Dict[str, Any]]) -> str:
    if tool_config:
        path = tool_config.get("db_path")
        if path:
            return path
    return _DEFAULT_DB_PATH

def _open_sqlite(db_path: str) -> sqlite3.Connection:
    if db_path != ":memory:" and not db_path.startswith("file:"):
        db_dir = os.path.dirname(os.path.abspath(db_path))
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)

    # Use a short timeout to avoid hanging on locked DBs.
    conn = sqlite3.connect(db_path, timeout=10, uri=db_path.startswith("file:"))
    _ensure_inventory_schema(conn)
    return conn

def _ensure_inventory_schema(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS inventory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_name TEXT NOT NULL,
          quantity REAL DEFAULT 0,
          quantity_unit TEXT,
          unit TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    # Backfill older table definitions that predate timestamp columns.
    cur.execute("PRAGMA table_info(inventory)")
    existing_columns = {row[1] for row in cur.fetchall()}
    if "created_at" not in existing_columns:
        cur.execute("ALTER TABLE inventory ADD COLUMN created_at TEXT")
        cur.execute(
            "UPDATE inventory SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL"
        )
    if "updated_at" not in existing_columns:
        cur.execute("ALTER TABLE inventory ADD COLUMN updated_at TEXT")
        cur.execute(
            "UPDATE inventory SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) "
            "WHERE updated_at IS NULL"
        )
    if "category" not in existing_columns:
        cur.execute("ALTER TABLE inventory ADD COLUMN category TEXT DEFAULT 'Other'")
        cur.execute("UPDATE inventory SET category = 'Other' WHERE category IS NULL")
    if "expires_at" not in existing_columns:
        cur.execute("ALTER TABLE inventory ADD COLUMN expires_at TEXT")

    # Shopping list table
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS shopping_list (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_name TEXT NOT NULL,
          quantity REAL DEFAULT 1,
          quantity_unit TEXT,
          unit TEXT,
          category TEXT DEFAULT 'Other',
          checked INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    conn.commit()


def _error_response(operation: str, message: str) -> Dict[str, Any]:
    return {
        "status": "error",
        "operation": operation,
        "message": message,
        "user_message": f"Inventory {operation} failed: {message}",
    }


def _normalize_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_quantity(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, str):
        stripped = value.strip()
        if stripped == "":
            return default
        return float(stripped)
    return float(value)


def _first_non_empty(item: Dict[str, Any], keys: List[str]) -> Optional[Any]:
    for key in keys:
        if key in item and item.get(key) is not None:
            value = item.get(key)
            if isinstance(value, str):
                if value.strip():
                    return value
                continue
            return value
    return None


def _canonicalize_unit_token(value: Optional[str]) -> Optional[str]:
    token = _normalize_text(value)
    if not token:
        return None
    lower = token.lower()
    aliases = {
        "kilogram": "kg",
        "kilograms": "kg",
        "gram": "g",
        "grams": "g",
        "liter": "L",
        "liters": "L",
        "litre": "L",
        "litres": "L",
        "milliliter": "ml",
        "milliliters": "ml",
        "millilitre": "ml",
        "millilitres": "ml",
        "piece": "unit",
        "pieces": "unit",
        "pcs": "unit",
        "pc": "unit",
        "each": "unit",
        "ea": "unit",
        "units": "unit",
    }
    return aliases.get(lower, token)


def _normalize_insert_item(item: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not isinstance(item, dict):
        return None, f"Expected object item, got {type(item).__name__}."

    product_name = _normalize_text(
        _first_non_empty(item, ["product_name", "product", "name", "item_name", "item"])
    )
    if not product_name:
        return None, "Missing product_name (or alias: product/name/item_name/item)."

    quantity_raw = _first_non_empty(item, ["quantity", "qty", "amount", "count"])
    quantity_unit_raw = _first_non_empty(
        item, ["quantity_unit", "quantityUnit", "uom", "measure", "measurement"]
    )
    unit_raw = _first_non_empty(item, ["unit", "package", "packaging"])

    quantity_unit = _canonicalize_unit_token(_normalize_text(quantity_unit_raw))
    unit = _canonicalize_unit_token(_normalize_text(unit_raw))

    # Support formats like "1kg", "1 kg", "250g" in quantity field.
    if isinstance(quantity_raw, str):
        stripped = quantity_raw.strip()
        unit_match = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$", stripped)
        if unit_match:
            quantity_raw = unit_match.group(1)
            inline_unit = _canonicalize_unit_token(unit_match.group(2))
            if inline_unit and not quantity_unit:
                quantity_unit = inline_unit
            if inline_unit and not unit:
                unit = inline_unit

    try:
        quantity = _parse_quantity(quantity_raw, default=0.0)
    except (TypeError, ValueError):
        return None, f"Invalid quantity value: {quantity_raw!r}."

    # If only one unit field is provided, mirror it to both fields for stable matching.
    if quantity_unit and not unit:
        unit = quantity_unit
    if unit and not quantity_unit:
        quantity_unit = unit

    category_raw = _normalize_text(
        _first_non_empty(item, ["category", "cat", "type"])
    )
    category = category_raw if category_raw in VALID_CATEGORIES else None

    expires_at = _normalize_text(item.get("expires_at"))

    return {
        "product_name": product_name,
        "quantity": quantity,
        "quantity_unit": quantity_unit,
        "unit": unit,
        "category": category,
        "expires_at": expires_at,
    }, None


def _find_existing_inventory_row(
    cur: sqlite3.Cursor,
    product_name: str,
    quantity_unit: Optional[str],
    unit: Optional[str],
) -> Optional[sqlite3.Row]:
    cur.execute(
        """
        SELECT id, product_name, quantity, quantity_unit, unit, category, expires_at, created_at, updated_at
        FROM inventory
        WHERE lower(trim(product_name)) = lower(trim(?))
          AND COALESCE(lower(trim(quantity_unit)), '') = COALESCE(lower(trim(?)), '')
          AND COALESCE(lower(trim(unit)), '') = COALESCE(lower(trim(?)), '')
        ORDER BY id DESC
        LIMIT 1
        """,
        (product_name, quantity_unit, unit),
    )
    return cur.fetchone()


def _normalize_unit_token(value: Any) -> Optional[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return None
    return normalized.lower()


def _find_existing_inventory_row_with_fallback(
    cur: sqlite3.Cursor,
    product_name: str,
    quantity_unit: Optional[str],
    unit: Optional[str],
) -> Tuple[Optional[sqlite3.Row], Optional[str]]:
    """
    Resolve an inventory row using exact matching first, then a safe fallback.

    Fallback behavior:
    - If exact lookup fails, search by product_name.
    - If unit tokens are provided, match candidates where those tokens appear in
      either quantity_unit or unit (to tolerate historical mixed column usage).
    - If no unit tokens are provided, only auto-match when product_name is unique.
    - Return an explicit ambiguity message when multiple candidates remain.
    """
    existing = _find_existing_inventory_row(
        cur=cur,
        product_name=product_name,
        quantity_unit=quantity_unit,
        unit=unit,
    )
    if existing:
        return existing, None

    cur.execute(
        """
        SELECT id, product_name, quantity, quantity_unit, unit, category, expires_at, created_at, updated_at
        FROM inventory
        WHERE lower(trim(product_name)) = lower(trim(?))
        ORDER BY id DESC
        LIMIT 50
        """,
        (product_name,),
    )
    candidates = cur.fetchall()
    if not candidates:
        return None, None

    requested_tokens = {
        token
        for token in (
            _normalize_unit_token(quantity_unit),
            _normalize_unit_token(unit),
        )
        if token
    }

    if not requested_tokens:
        if len(candidates) == 1:
            return candidates[0], None
        return (
            None,
            (
                f"Ambiguous item lookup for product_name='{product_name}'. "
                "Multiple rows exist; please specify quantity_unit and/or unit."
            ),
        )

    matched_rows: List[sqlite3.Row] = []
    for row in candidates:
        row_tokens = {
            token
            for token in (
                _normalize_unit_token(row["quantity_unit"]),
                _normalize_unit_token(row["unit"]),
            )
            if token
        }
        if requested_tokens.issubset(row_tokens):
            matched_rows.append(row)

    if len(matched_rows) == 1:
        return matched_rows[0], None
    if len(matched_rows) > 1:
        tokens = ", ".join(sorted(requested_tokens))
        return (
            None,
            (
                f"Ambiguous item lookup for product_name='{product_name}' and units '{tokens}'. "
                "Multiple rows match; please specify both quantity_unit and unit."
            ),
        )
    return None, None


async def insert_inventory_items(
    items: List[Dict[str, Any]],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Insert inventory rows into the inventory table.

    Each item should include: product_name, quantity, quantity_unit, unit.
    If an item already exists (same product_name + quantity_unit + unit),
    quantity is increased instead of inserting a duplicate row.
    """
    log_id = "[InventoryTools:insert_inventory_items]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("insert", "Missing db_path in tool_config.")

    if not items:
        return _error_response("insert", "No items provided.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        inserted = 0
        increased = 0
        skipped = 0
        skipped_details: List[str] = []

        for idx, raw_item in enumerate(items):
            normalized_item, normalize_error = _normalize_insert_item(raw_item)
            if normalize_error:
                skipped += 1
                skipped_details.append(f"index={idx}: {normalize_error}")
                continue

            product_name = normalized_item["product_name"]
            quantity = normalized_item["quantity"]
            quantity_unit = normalized_item["quantity_unit"]
            unit = normalized_item["unit"]
            category = normalized_item.get("category")
            expires_at = normalized_item.get("expires_at")

            existing = _find_existing_inventory_row(
                cur=cur,
                product_name=product_name,
                quantity_unit=quantity_unit,
                unit=unit,
            )
            if existing:
                current_quantity = _parse_quantity(existing["quantity"], default=0.0)
                new_quantity = current_quantity + quantity
                # Keep the earliest expiry date
                merged_expires = None
                ex_existing = existing["expires_at"]
                if ex_existing and expires_at:
                    merged_expires = min(ex_existing, expires_at)
                elif ex_existing:
                    merged_expires = ex_existing
                elif expires_at:
                    merged_expires = expires_at
                cur.execute(
                    """
                    UPDATE inventory
                    SET quantity = ?,
                        quantity_unit = COALESCE(?, quantity_unit),
                        unit = COALESCE(?, unit),
                        category = COALESCE(?, category),
                        expires_at = COALESCE(?, expires_at),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (new_quantity, quantity_unit, unit, category, merged_expires, existing["id"]),
                )
                increased += 1
                continue

            # Auto-estimate expiry if not provided
            if not expires_at:
                expires_at = _estimate_expiry(category or "Other")

            cur.execute(
                """
                INSERT INTO inventory (product_name, quantity, quantity_unit, unit, category, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (product_name, quantity, quantity_unit, unit, category or "Other", expires_at),
            )
            inserted += 1

        if inserted == 0 and increased == 0:
            details = "; ".join(skipped_details[:8]) if skipped_details else "No valid items."
            return _error_response(
                "insert",
                f"No valid items to insert. {details}",
            )

        conn.commit()
        log.info(
            f"{log_id} Inserted {inserted}, increased {increased}, skipped {skipped}"
        )
        return {
            "status": "success",
            "inserted": inserted,
            "increased": increased,
            "skipped": skipped,
            "processed": len(items),
            "skipped_details": skipped_details[:20],
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("insert", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("insert", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def increase_inventory_stock(
    product_name: str,
    quantity_to_add: float,
    quantity_unit: Optional[str] = None,
    unit: Optional[str] = None,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Increase stock for an existing item identified by:
    product_name + quantity_unit + unit.
    """
    log_id = "[InventoryTools:increase_inventory_stock]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("increase", "Missing db_path in tool_config.")

    normalized_name = _normalize_text(product_name)
    if not normalized_name:
        return _error_response("increase", "Missing product_name.")

    try:
        quantity_delta = _parse_quantity(quantity_to_add)
    except (TypeError, ValueError):
        return _error_response("increase", f"Invalid quantity_to_add: {quantity_to_add!r}")

    if quantity_delta <= 0:
        return _error_response("increase", "quantity_to_add must be greater than 0.")

    normalized_quantity_unit = _normalize_text(quantity_unit)
    normalized_unit = _normalize_text(unit)

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        existing, lookup_error = _find_existing_inventory_row_with_fallback(
            cur=cur,
            product_name=normalized_name,
            quantity_unit=normalized_quantity_unit,
            unit=normalized_unit,
        )
        if lookup_error:
            return _error_response("increase", lookup_error)
        if not existing:
            return _error_response(
                "increase",
                (
                    "Item does not exist. Use insert_inventory_items to add it first. "
                    f"Lookup key: product_name='{normalized_name}', "
                    f"quantity_unit='{normalized_quantity_unit}', unit='{normalized_unit}'."
                ),
            )

        current_quantity = _parse_quantity(existing["quantity"], default=0.0)
        new_quantity = current_quantity + quantity_delta
        cur.execute(
            """
            UPDATE inventory
            SET quantity = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_quantity, existing["id"]),
        )
        conn.commit()

        log.info(
            f"{log_id} Increased id={existing['id']} by {quantity_delta}. New quantity={new_quantity}"
        )
        return {
            "status": "success",
            "updated": 1,
            "item": {
                "id": existing["id"],
                "product_name": existing["product_name"],
                "quantity_unit": existing["quantity_unit"],
                "unit": existing["unit"],
                "previous_quantity": current_quantity,
                "quantity_added": quantity_delta,
                "new_quantity": new_quantity,
            },
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("increase", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("increase", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def decrease_inventory_stock(
    product_name: str,
    quantity_to_remove: float,
    quantity_unit: Optional[str] = None,
    unit: Optional[str] = None,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Decrease stock for an existing item identified by:
    product_name + quantity_unit + unit.
    """
    log_id = "[InventoryTools:decrease_inventory_stock]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("decrease", "Missing db_path in tool_config.")

    normalized_name = _normalize_text(product_name)
    if not normalized_name:
        return _error_response("decrease", "Missing product_name.")

    try:
        quantity_delta = _parse_quantity(quantity_to_remove)
    except (TypeError, ValueError):
        return _error_response(
            "decrease", f"Invalid quantity_to_remove: {quantity_to_remove!r}"
        )

    if quantity_delta <= 0:
        return _error_response("decrease", "quantity_to_remove must be greater than 0.")

    normalized_quantity_unit = _normalize_text(quantity_unit)
    normalized_unit = _normalize_text(unit)

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        existing, lookup_error = _find_existing_inventory_row_with_fallback(
            cur=cur,
            product_name=normalized_name,
            quantity_unit=normalized_quantity_unit,
            unit=normalized_unit,
        )
        if lookup_error:
            return _error_response("decrease", lookup_error)
        if not existing:
            return _error_response(
                "decrease",
                (
                    "Item does not exist. Use insert_inventory_items to add it first. "
                    f"Lookup key: product_name='{normalized_name}', "
                    f"quantity_unit='{normalized_quantity_unit}', unit='{normalized_unit}'."
                ),
            )

        current_quantity = _parse_quantity(existing["quantity"], default=0.0)
        if quantity_delta > current_quantity:
            return _error_response(
                "decrease",
                (
                    f"Cannot remove {quantity_delta}. Available quantity is "
                    f"{current_quantity}."
                ),
            )

        new_quantity = current_quantity - quantity_delta
        cur.execute(
            """
            UPDATE inventory
            SET quantity = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_quantity, existing["id"]),
        )
        conn.commit()

        log.info(
            f"{log_id} Decreased id={existing['id']} by {quantity_delta}. New quantity={new_quantity}"
        )
        return {
            "status": "success",
            "updated": 1,
            "item": {
                "id": existing["id"],
                "product_name": existing["product_name"],
                "quantity_unit": existing["quantity_unit"],
                "unit": existing["unit"],
                "previous_quantity": current_quantity,
                "quantity_removed": quantity_delta,
                "new_quantity": new_quantity,
            },
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("decrease", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("decrease", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def delete_inventory_item(
    product_name: str,
    quantity_unit: Optional[str] = None,
    unit: Optional[str] = None,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Delete an inventory item identified by product_name (and optionally quantity_unit + unit).
    The item is permanently removed from the database.
    """
    log_id = "[InventoryTools:delete_inventory_item]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("delete", "Missing db_path in tool_config.")

    normalized_name = _normalize_text(product_name)
    if not normalized_name:
        return _error_response("delete", "Missing product_name.")

    normalized_quantity_unit = _normalize_text(quantity_unit)
    normalized_unit = _normalize_text(unit)

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        existing, lookup_error = _find_existing_inventory_row_with_fallback(
            cur=cur,
            product_name=normalized_name,
            quantity_unit=normalized_quantity_unit,
            unit=normalized_unit,
        )
        if lookup_error:
            return _error_response("delete", lookup_error)
        if not existing:
            return _error_response(
                "delete",
                (
                    f"Item not found. "
                    f"Lookup key: product_name='{normalized_name}', "
                    f"quantity_unit='{normalized_quantity_unit}', unit='{normalized_unit}'."
                ),
            )

        cur.execute("DELETE FROM inventory WHERE id = ?", (existing["id"],))
        conn.commit()

        log.info(f"{log_id} Deleted id={existing['id']} product_name='{existing['product_name']}'")
        return {
            "status": "success",
            "deleted": 1,
            "item": {
                "id": existing["id"],
                "product_name": existing["product_name"],
                "quantity": existing["quantity"],
                "quantity_unit": existing["quantity_unit"],
                "unit": existing["unit"],
            },
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("delete", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("delete", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def bulk_delete_inventory_items(
    items: List[Dict[str, Any]],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Delete multiple inventory items at once.

    Each item in the list should include at least product_name, and optionally
    quantity_unit and unit for precise matching. Returns a summary of how many
    items were deleted, not found, or had errors.
    """
    log_id = "[InventoryTools:bulk_delete_inventory_items]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("bulk_delete", "Missing db_path in tool_config.")

    if not items:
        return _error_response("bulk_delete", "No items provided.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        deleted = 0
        not_found = 0
        errored = 0
        details: List[Dict[str, Any]] = []

        for idx, raw_item in enumerate(items):
            if not isinstance(raw_item, dict):
                errored += 1
                details.append({"index": idx, "status": "error", "message": f"Expected object, got {type(raw_item).__name__}."})
                continue

            product_name = _normalize_text(
                _first_non_empty(raw_item, ["product_name", "product", "name", "item_name", "item"])
            )
            if not product_name:
                errored += 1
                details.append({"index": idx, "status": "error", "message": "Missing product_name."})
                continue

            quantity_unit = _canonicalize_unit_token(
                _normalize_text(_first_non_empty(raw_item, ["quantity_unit", "quantityUnit", "uom", "measure"]))
            )
            unit = _canonicalize_unit_token(
                _normalize_text(_first_non_empty(raw_item, ["unit", "package", "packaging"]))
            )

            existing, lookup_error = _find_existing_inventory_row_with_fallback(
                cur=cur,
                product_name=product_name,
                quantity_unit=quantity_unit,
                unit=unit,
            )
            if lookup_error:
                errored += 1
                details.append({"index": idx, "product_name": product_name, "status": "error", "message": lookup_error})
                continue
            if not existing:
                not_found += 1
                details.append({"index": idx, "product_name": product_name, "status": "not_found"})
                continue

            cur.execute("DELETE FROM inventory WHERE id = ?", (existing["id"],))
            deleted += 1
            details.append({
                "index": idx,
                "product_name": existing["product_name"],
                "status": "deleted",
                "id": existing["id"],
            })

        conn.commit()
        log.info(f"{log_id} Deleted {deleted}, not_found {not_found}, errored {errored}")
        return {
            "status": "success",
            "deleted": deleted,
            "not_found": not_found,
            "errored": errored,
            "processed": len(items),
            "details": details[:50],
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("bulk_delete", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("bulk_delete", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ── Ingredient categories for recipe-aware inventory queries ───────

INGREDIENT_CATEGORIES = {
    "Meat & Poultry": ["chicken", "beef", "pork", "lamb", "turkey", "duck", "bacon", "sausage", "ham", "steak", "ground"],
    "Seafood": ["salmon", "shrimp", "tuna", "cod", "fish", "crab", "lobster", "prawn", "squid", "mussel"],
    "Dairy & Eggs": ["milk", "cheese", "butter", "cream", "yogurt", "egg", "sour cream", "whipping"],
    "Produce": ["tomato", "onion", "garlic", "pepper", "carrot", "potato", "lettuce", "spinach", "broccoli", "mushroom", "celery", "cucumber", "avocado", "corn", "bean", "pea", "zucchini", "eggplant", "cabbage", "kale"],
    "Fruits": ["apple", "banana", "lemon", "lime", "orange", "berry", "strawberry", "blueberry", "mango", "pineapple", "grape", "peach", "pear"],
    "Grains & Pasta": ["rice", "pasta", "noodle", "bread", "flour", "oat", "quinoa", "couscous", "tortilla", "wrap"],
    "Condiments & Sauces": ["soy sauce", "vinegar", "ketchup", "mustard", "mayo", "hot sauce", "worcestershire", "teriyaki", "salsa", "pesto"],
    "Oils & Fats": ["olive oil", "vegetable oil", "coconut oil", "sesame oil", "cooking spray"],
    "Herbs & Spices": ["salt", "pepper", "cumin", "paprika", "oregano", "basil", "thyme", "rosemary", "cinnamon", "ginger", "turmeric", "chili", "parsley", "cilantro", "dill", "bay leaf", "nutmeg"],
    "Canned & Preserved": ["canned", "tomato paste", "tomato sauce", "coconut milk", "broth", "stock"],
    "Baking": ["sugar", "baking soda", "baking powder", "vanilla", "cocoa", "chocolate", "honey", "maple syrup", "yeast"],
}

RECIPE_CATEGORY_SHELF_LIFE_DAYS = {
    "Meat & Poultry": 3,
    "Seafood": 2,
    "Dairy & Eggs": 7,
    "Produce": 5,
    "Fruits": 5,
    "Grains & Pasta": 180,
    "Condiments & Sauces": 90,
    "Oils & Fats": 180,
    "Herbs & Spices": 365,
    "Canned & Preserved": 365,
    "Baking": 180,
    "Other": 14,
}


def _categorize_ingredient(product_name: str) -> str:
    """Assign a food category to a product name via keyword matching."""
    name_lower = product_name.lower()
    for category, keywords in INGREDIENT_CATEGORIES.items():
        for kw in keywords:
            if kw in name_lower:
                return category
    return "Other"


def _compute_priority(category: str, quantity: float, days_old: float) -> float:
    """Compute a priority score (0.0-1.0) combining perishability, quantity, and age."""
    shelf_life = RECIPE_CATEGORY_SHELF_LIFE_DAYS.get(category, 14)
    perishability = 1.0 - min(shelf_life / 365.0, 1.0)
    quantity_weight = min(quantity / 10.0, 1.0)
    age_weight = min(days_old / shelf_life, 1.0) if shelf_life > 0 else 0.0
    return round(0.50 * perishability + 0.30 * quantity_weight + 0.20 * age_weight, 3)


async def get_inventory_for_recipes(
    limit: int = 40,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return inventory items with quantities, grouped by food category, for intelligent recipe search."""
    log_id = "[InventoryTools:get_inventory_for_recipes]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("read", "Missing db_path in tool_config.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT product_name, quantity, quantity_unit, updated_at "
            "FROM inventory WHERE quantity > 0 ORDER BY product_name LIMIT ?",
            (limit,),
        )
        rows = cur.fetchall()
        log.info(f"{log_id} Found {len(rows)} item(s)")

        if not rows:
            return {
                "status": "success",
                "total_count": 0,
                "use_first": [],
                "items": [],
                "by_category": {},
                "ingredient_names_csv": "",
            }

        from datetime import datetime

        now = datetime.utcnow()
        items = []
        for row in rows:
            name = row["product_name"]
            qty = row["quantity"] or 0
            qty_unit = row["quantity_unit"] or "unit"
            updated_at_str = row["updated_at"]
            category = _categorize_ingredient(name)
            shelf_life = RECIPE_CATEGORY_SHELF_LIFE_DAYS.get(category, 14)

            days_old = 0.0
            if updated_at_str:
                try:
                    updated_dt = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00").replace("+00:00", ""))
                    days_old = max((now - updated_dt).total_seconds() / 86400.0, 0.0)
                except (ValueError, TypeError):
                    pass

            priority = _compute_priority(category, qty, days_old)
            items.append({
                "product_name": name,
                "quantity": qty,
                "quantity_unit": qty_unit,
                "category": category,
                "priority": priority,
                "days_old": round(days_old, 1),
                "shelf_life_days": shelf_life,
            })

        items.sort(key=lambda x: x["priority"], reverse=True)

        use_first = []
        for item in items:
            if item["priority"] > 0.7:
                use_first.append({
                    **item,
                    "reason": f"{item['category']} — {item['days_old']:.0f} of {item['shelf_life_days']} days shelf life used",
                })

        by_category: Dict[str, List[str]] = {}
        for item in items:
            cat = item["category"]
            label = f"{item['product_name']} ({item['quantity']} {item['quantity_unit']}"
            if item["priority"] > 0.7:
                label += ", ⚠️ use soon"
            label += ")"
            by_category.setdefault(cat, []).append(label)

        csv = ",".join(item["product_name"] for item in items)

        return {
            "status": "success",
            "total_count": len(items),
            "use_first": use_first,
            "items": items,
            "by_category": by_category,
            "ingredient_names_csv": csv,
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("read", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("read", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _to_ml(amount: float, unit: str) -> Optional[float]:
    factor = _ML_PER_UNIT.get(unit.lower())
    return amount * factor if factor is not None else None


def _to_g(amount: float, unit: str) -> Optional[float]:
    factor = _G_PER_UNIT.get(unit.lower())
    return amount * factor if factor is not None else None


def _fuzzy_match_ingredient(inv_name: str, recipe_name: str) -> bool:
    inv_lower = inv_name.lower()
    rec_lower = recipe_name.lower()
    if inv_lower == rec_lower:
        return True
    if inv_lower in rec_lower or rec_lower in inv_lower:
        return True
    inv_words = inv_lower.split()
    rec_words = rec_lower.split()
    if inv_words and rec_words and inv_words[0] == rec_words[0] and len(inv_words[0]) >= 4:
        return True
    for word in rec_words:
        if len(word) >= 4 and word in inv_lower:
            return True
    return False


def _check_ingredient_quantity(
    recipe_name: str,
    recipe_amount: Optional[float],
    recipe_unit: str,
    inv_quantity: float,
    inv_unit: str,
) -> str:
    """Return 'sufficient', 'insufficient', or 'unit_uncertain'."""
    TOLERANCE = 1.10  # 10% tolerance (inv must cover recipe_amount / TOLERANCE)

    if not recipe_amount:
        return "sufficient"

    r_unit = (recipe_unit or "").strip().lower()
    i_unit = (inv_unit or "").strip().lower()

    # Both volume units
    r_ml = _to_ml(recipe_amount, r_unit) if r_unit else None
    i_ml = _to_ml(inv_quantity, i_unit) if i_unit else None
    if r_ml is not None and i_ml is not None:
        return "sufficient" if i_ml * TOLERANCE >= r_ml else "insufficient"

    # Both weight units
    r_g = _to_g(recipe_amount, r_unit) if r_unit else None
    i_g = _to_g(inv_quantity, i_unit) if i_unit else None
    if r_g is not None and i_g is not None:
        return "sufficient" if i_g * TOLERANCE >= r_g else "insufficient"

    # Same unit (normalized)
    if r_unit and r_unit == i_unit:
        return "sufficient" if inv_quantity * TOLERANCE >= recipe_amount else "insufficient"

    # INGREDIENT_CONVERSIONS lookup
    name_lower = recipe_name.lower()
    for keyword, unit_map in INGREDIENT_CONVERSIONS.items():
        if keyword in name_lower:
            # Try converting inventory unit
            if i_unit in unit_map:
                to_unit, factor = unit_map[i_unit]
                inv_converted = inv_quantity * factor
                # Now compare in to_unit
                inv_ml2 = _to_ml(inv_converted, to_unit)
                rec_ml2 = _to_ml(recipe_amount, r_unit) if r_unit else None
                if inv_ml2 is not None and rec_ml2 is not None:
                    return "sufficient" if inv_ml2 * TOLERANCE >= rec_ml2 else "insufficient"
                inv_g2 = _to_g(inv_converted, to_unit)
                rec_g2 = _to_g(recipe_amount, r_unit) if r_unit else None
                if inv_g2 is not None and rec_g2 is not None:
                    return "sufficient" if inv_g2 * TOLERANCE >= rec_g2 else "insufficient"
                if to_unit == r_unit:
                    return "sufficient" if inv_converted * TOLERANCE >= recipe_amount else "insufficient"
            # Try converting recipe unit
            if r_unit in unit_map:
                to_unit, factor = unit_map[r_unit]
                rec_converted = recipe_amount * factor
                inv_ml3 = _to_ml(inv_quantity, i_unit) if i_unit else None
                rec_ml3 = _to_ml(rec_converted, to_unit)
                if inv_ml3 is not None and rec_ml3 is not None:
                    return "sufficient" if inv_ml3 * TOLERANCE >= rec_ml3 else "insufficient"
                inv_g3 = _to_g(inv_quantity, i_unit) if i_unit else None
                rec_g3 = _to_g(rec_converted, to_unit)
                if inv_g3 is not None and rec_g3 is not None:
                    return "sufficient" if inv_g3 * TOLERANCE >= rec_g3 else "insufficient"
                if to_unit == i_unit:
                    return "sufficient" if inv_quantity * TOLERANCE >= rec_converted else "insufficient"
            break

    return "unit_uncertain"


async def get_ingredient_names(
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return a comma-separated string of all product names in inventory, ready for recipe search."""
    log_id = "[InventoryTools:get_ingredient_names]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("read", "Missing db_path in tool_config.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT product_name FROM inventory WHERE quantity > 0 ORDER BY product_name"
        )
        names = [row["product_name"] for row in cur.fetchall()]
        log.info(f"{log_id} Found {len(names)} ingredient(s)")
        if not names:
            return {
                "status": "success",
                "count": 0,
                "ingredients": "",
                "message": "Inventory is empty.",
            }
        return {
            "status": "success",
            "count": len(names),
            "ingredients": ",".join(names),
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("read", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("read", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def get_prioritized_ingredients(
    max_ingredients: int = 20,
    exclude_categories: str = "Condiments,Baking,Beverages",
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Return inventory ingredients filtered by category tier and sorted by expiry date.
    Excludes condiments/baking/beverages. Hero ingredients (Meat, Produce, Dairy, Seafood)
    are prioritized first. Useful for recipe search when inventory is large (50–200 items).
    """
    log_id = "[InventoryTools:get_prioritized_ingredients]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("read", "Missing db_path in tool_config.")

    TIER1 = {"Meat", "Seafood", "Produce", "Dairy"}
    TIER2 = {"Grains", "Frozen", "Canned", "Snacks", "Other"}
    excluded = {c.strip() for c in exclude_categories.split(",") if c.strip()}

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT product_name, category, expires_at "
            "FROM inventory WHERE quantity > 0 "
            "ORDER BY CASE WHEN expires_at IS NULL OR expires_at = '' THEN 1 ELSE 0 END, expires_at ASC"
        )
        rows = cur.fetchall()

        tier1_items: List[str] = []
        tier2_items: List[str] = []

        for row in rows:
            category = (row["category"] or "Other").strip()
            name = row["product_name"]
            if category in excluded:
                continue
            if category in TIER1:
                tier1_items.append(name)
            elif category in TIER2 or category not in excluded:
                tier2_items.append(name)

        # Cap: fill tier1 first, then tier2 up to max_ingredients
        selected_t1 = tier1_items[:max_ingredients]
        remaining = max_ingredients - len(selected_t1)
        selected_t2 = tier2_items[:remaining] if remaining > 0 else []
        all_selected = selected_t1 + selected_t2

        log.info(f"{log_id} Selected {len(all_selected)} ingredients (tier1={len(selected_t1)}, tier2={len(selected_t2)})")

        if not all_selected:
            return {
                "status": "success",
                "count": 0,
                "ingredients": "",
                "tier_breakdown": {"hero": [], "supporting": []},
                "message": "No relevant ingredients found in inventory.",
            }
        return {
            "status": "success",
            "count": len(all_selected),
            "ingredients": ",".join(all_selected),
            "tier_breakdown": {"hero": selected_t1, "supporting": selected_t2},
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("read", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("read", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def check_recipe_ingredient_sufficiency(
    recipes_json: str,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Cross-check recipe ingredient quantities against inventory quantities.
    Spoonacular matches ingredients by name only; this tool detects cases where
    the user has the ingredient but not enough of it.

    recipes_json: JSON string (or pre-serialized list) of recipe objects from
                  get_top_3_meals / complex_search / get_meal_details_bulk.
    """
    log_id = "[InventoryTools:check_recipe_ingredient_sufficiency]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("read", "Missing db_path in tool_config.")

    # Parse input
    if isinstance(recipes_json, list):
        recipes = recipes_json
    else:
        try:
            recipes = json.loads(recipes_json)
        except (json.JSONDecodeError, TypeError) as e:
            return _error_response("read", f"Invalid recipes_json: {e}")

    if not isinstance(recipes, list):
        recipes = [recipes]

    # Load inventory
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT product_name, quantity, quantity_unit, unit FROM inventory WHERE quantity > 0"
        )
        inv_rows = cur.fetchall()
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("read", f"SQLite error: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

    # Build inventory lookup list
    inventory: List[Dict] = []
    for row in inv_rows:
        inventory.append({
            "name": (row["product_name"] or "").strip(),
            "quantity": float(row["quantity"] or 0),
            "unit": (row["quantity_unit"] or row["unit"] or "").strip(),
        })

    enriched_recipes = []
    for recipe in recipes:
        insufficient: List[Dict] = []
        used_ings = recipe.get("usedIngredients", [])

        for ing in used_ings:
            recipe_name = ing.get("ingredient", "")
            if not recipe_name:
                continue

            # Find matching inventory row
            match = None
            for inv in inventory:
                if _fuzzy_match_ingredient(inv["name"], recipe_name):
                    match = inv
                    break

            if match is None:
                continue  # not in inventory — trust Spoonacular

            # Get amount/unit — prefer explicit fields, fall back to parsing measure
            recipe_amount = ing.get("amount")
            recipe_unit = ing.get("unit", "")
            if recipe_amount is None:
                measure = ing.get("measure", "")
                parts = measure.split(None, 1)
                try:
                    recipe_amount = float(parts[0]) if parts else None
                    recipe_unit = parts[1] if len(parts) > 1 else ""
                except (ValueError, IndexError):
                    recipe_amount = None
                    recipe_unit = ""

            result = _check_ingredient_quantity(
                recipe_name, recipe_amount, recipe_unit,
                match["quantity"], match["unit"],
            )

            if result != "sufficient":
                have_str = f"{match['quantity']} {match['unit']}".strip()
                need_str = f"{recipe_amount} {recipe_unit}".strip() if recipe_amount else ing.get("measure", "?")
                insufficient.append({
                    "ingredient": recipe_name,
                    "have": have_str,
                    "need": need_str,
                    "status": result,
                })

        enriched = dict(recipe)
        enriched["insufficientIngredients"] = insufficient
        enriched_recipes.append(enriched)

    log.info(f"{log_id} Checked {len(recipes)} recipes; insufficiency found in {sum(1 for r in enriched_recipes if r['insufficientIngredients'])} recipes")
    return {
        "status": "success",
        "count": len(enriched_recipes),
        "meals": enriched_recipes,
    }


async def list_inventory_items(
    limit: int = 100,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Return up to `limit` inventory rows.
    """
    log_id = "[InventoryTools:list_inventory_items]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("read", "Missing db_path in tool_config.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, product_name, quantity, quantity_unit, unit, category, expires_at, created_at, updated_at
            FROM inventory
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = [dict(row) for row in cur.fetchall()]
        log.info(f"{log_id} Retrieved {len(rows)} rows")
        return {"status": "success", "count": len(rows), "rows": rows}
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("read", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("read", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def search_inventory_items(
    query: Optional[str] = None,
    category: Optional[str] = None,
    added_after: Optional[str] = None,
    added_before: Optional[str] = None,
    expiring_within_days: Optional[int] = None,
    include_expired: bool = False,
    limit: int = 50,
    categories: Optional[List[str]] = None,
    min_quantity: Optional[float] = None,
    max_quantity: Optional[float] = None,
    expired_only: bool = False,
    missing_expiration: Optional[bool] = None,
    updated_after: Optional[str] = None,
    updated_before: Optional[str] = None,
    sort_by: Optional[str] = None,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Search and filter inventory items. All parameters are optional — combine
    them to narrow results.

    TEXT SEARCH:
    - query: substring match on product_name (case-insensitive).
      Example: query="chick" matches "Chicken Breast", "Chickpeas".

    CATEGORY FILTERS (use one, not both):
    - category: exact match on a single category (e.g. "Dairy").
    - categories: match ANY of several categories (e.g. ["Dairy", "Produce"]).
      If both provided, categories takes precedence.
      Valid values: Produce, Dairy, Meat, Seafood, Grains, Beverages, Snacks,
                    Condiments, Frozen, Baking, Canned, Other.

    QUANTITY FILTERS:
    - min_quantity: items with quantity >= this value.
      Example: min_quantity=5 for "what do I have a lot of?"
    - max_quantity: items with quantity <= this value.
      Example: max_quantity=0 for "what's out of stock?",
               max_quantity=1 for "what am I running low on?"

    EXPIRATION FILTERS:
    - expiring_within_days: items expiring within N days from today.
      Excludes already-expired items unless include_expired=True.
    - include_expired: when True with expiring_within_days, also return
      already-expired items. No effect without expiring_within_days.
    - expired_only: return ONLY items already expired (expires_at < today).
      Takes precedence over expiring_within_days if both set.
    - missing_expiration: if True, return only items with NO expiration date.
      If False, return only items that HAVE an expiration date. Omit to include both.

    DATE FILTERS (ISO date strings, e.g. "2026-03-13"):
    - added_after / added_before: filter on created_at.
    - updated_after / updated_before: filter on updated_at.
      Example: updated_after="2026-03-13" for "what changed recently?"

    SORTING:
    - sort_by: column and direction. Format: "<column>" or "<column>_asc"/"<column>_desc".
      Columns: name, quantity, category, expires_at, created_at, updated_at.
      Examples: "expires_at_asc" (soonest first), "quantity_asc" (lowest stock first),
                "name" (alphabetical A-Z), "updated_at_desc" (recently changed first).
      Default when omitted: "created_at_desc".

    PAGINATION:
    - limit: max rows to return (default 50, max 200).
    """
    log_id = "[InventoryTools:search_inventory_items]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("read", "Missing db_path in tool_config.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        conditions = []
        params = []

        # --- Text search ---
        if query:
            conditions.append("product_name LIKE ?")
            params.append(f"%{query}%")

        # --- Category (multi takes precedence over single) ---
        if categories and isinstance(categories, list) and len(categories) > 0:
            placeholders = ", ".join("?" for _ in categories)
            conditions.append(f"category IN ({placeholders})")
            params.extend(categories)
        elif category:
            conditions.append("category = ?")
            params.append(category)

        # --- Quantity thresholds ---
        if min_quantity is not None:
            conditions.append("quantity >= ?")
            params.append(min_quantity)
        if max_quantity is not None:
            conditions.append("quantity <= ?")
            params.append(max_quantity)

        # --- Expiration filters ---
        if expired_only:
            conditions.append("expires_at IS NOT NULL")
            conditions.append("DATE(expires_at) < DATE('now')")
        elif expiring_within_days is not None:
            conditions.append("expires_at IS NOT NULL")
            conditions.append("DATE(expires_at) <= DATE('now', ?)")
            params.append(f"+{expiring_within_days} days")
            if not include_expired:
                conditions.append("DATE(expires_at) >= DATE('now')")

        if missing_expiration is True:
            conditions.append("expires_at IS NULL")
        elif missing_expiration is False:
            conditions.append("expires_at IS NOT NULL")

        # --- Date filters: created_at ---
        if added_after:
            conditions.append("DATE(created_at) >= DATE(?)")
            params.append(added_after)
        if added_before:
            conditions.append("DATE(created_at) < DATE(?)")
            params.append(added_before)

        # --- Date filters: updated_at ---
        if updated_after:
            conditions.append("DATE(updated_at) >= DATE(?)")
            params.append(updated_after)
        if updated_before:
            conditions.append("DATE(updated_at) < DATE(?)")
            params.append(updated_before)

        # --- Sort ---
        sort_column_map = {
            "name": "product_name",
            "quantity": "quantity",
            "category": "category",
            "expires_at": "expires_at",
            "created_at": "created_at",
            "updated_at": "updated_at",
        }
        default_directions = {
            "name": "ASC",
            "quantity": "DESC",
            "category": "ASC",
            "expires_at": "ASC",
            "created_at": "DESC",
            "updated_at": "DESC",
        }

        order_clause = "created_at DESC"
        if sort_by:
            sort_lower = sort_by.strip().lower()
            direction = None
            if sort_lower.endswith("_asc"):
                sort_key = sort_lower[:-4]
                direction = "ASC"
            elif sort_lower.endswith("_desc"):
                sort_key = sort_lower[:-5]
                direction = "DESC"
            else:
                sort_key = sort_lower

            if sort_key in sort_column_map:
                col = sort_column_map[sort_key]
                if direction is None:
                    direction = default_directions.get(sort_key, "ASC")
                order_clause = f"{col} {direction}"
            else:
                log.warning(f"{log_id} Unrecognized sort_by='{sort_by}', using default")

        # Push NULLs to bottom when sorting by expires_at
        if order_clause.startswith("expires_at"):
            order_clause = f"expires_at IS NULL, {order_clause}"

        where = " AND ".join(conditions) if conditions else "1=1"
        effective_limit = min(limit, 200)

        sql = f"""
            SELECT id, product_name, quantity, quantity_unit, unit,
                   category, expires_at, created_at, updated_at
            FROM inventory
            WHERE {where}
            ORDER BY {order_clause}
            LIMIT ?
        """
        params.append(effective_limit)

        cur.execute(sql, params)
        rows = [dict(row) for row in cur.fetchall()]

        filters_applied = {
            "query": query,
            "category": category,
            "categories": categories,
            "min_quantity": min_quantity,
            "max_quantity": max_quantity,
            "added_after": added_after,
            "added_before": added_before,
            "updated_after": updated_after,
            "updated_before": updated_before,
            "expiring_within_days": expiring_within_days,
            "expired_only": expired_only if expired_only else None,
            "missing_expiration": missing_expiration,
            "sort_by": sort_by,
        }
        filters_applied = {k: v for k, v in filters_applied.items() if v is not None}

        log.info(f"{log_id} Retrieved {len(rows)} rows with filters: {filters_applied}")
        return {
            "status": "success",
            "count": len(rows),
            "filters_applied": filters_applied,
            "rows": rows,
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("read", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("read", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Shopping list tools
# ---------------------------------------------------------------------------


async def list_shopping_list_items(
    limit: int = 200,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return all shopping list items."""
    log_id = "[InventoryTools:list_shopping_list_items]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("read", "Missing db_path in tool_config.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, product_name, quantity, quantity_unit, unit, category,
                   checked, created_at, updated_at
            FROM shopping_list
            ORDER BY checked ASC, id DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = [dict(row) for row in cur.fetchall()]
        log.info(f"{log_id} Retrieved {len(rows)} shopping list rows")
        return {"status": "success", "count": len(rows), "rows": rows}
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("read", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("read", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def insert_shopping_list_items(
    items: List[Dict[str, Any]],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Add items to the shopping list. Duplicates (same name+unit) increase quantity."""
    log_id = "[InventoryTools:insert_shopping_list_items]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("insert", "Missing db_path in tool_config.")
    if not items:
        return _error_response("insert", "No items provided.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        inserted = 0
        increased = 0
        skipped = 0
        skipped_details: List[str] = []

        for idx, raw_item in enumerate(items):
            normalized_item, normalize_error = _normalize_insert_item(raw_item)
            if normalize_error:
                skipped += 1
                skipped_details.append(f"index={idx}: {normalize_error}")
                continue

            product_name = normalized_item["product_name"]
            quantity = normalized_item["quantity"]
            quantity_unit = normalized_item["quantity_unit"]
            unit = normalized_item["unit"]
            category = normalized_item.get("category")

            # Check for existing item in shopping list
            cur.execute(
                """
                SELECT id, quantity FROM shopping_list
                WHERE lower(trim(product_name)) = lower(trim(?))
                  AND COALESCE(lower(trim(quantity_unit)), '') = COALESCE(lower(trim(?)), '')
                  AND COALESCE(lower(trim(unit)), '') = COALESCE(lower(trim(?)), '')
                ORDER BY id DESC LIMIT 1
                """,
                (product_name, quantity_unit, unit),
            )
            existing = cur.fetchone()
            if existing:
                new_qty = _parse_quantity(existing["quantity"], 0.0) + quantity
                cur.execute(
                    """
                    UPDATE shopping_list
                    SET quantity = ?, category = COALESCE(?, category),
                        checked = 0, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (new_qty, category, existing["id"]),
                )
                increased += 1
            else:
                cur.execute(
                    """
                    INSERT INTO shopping_list
                        (product_name, quantity, quantity_unit, unit, category)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (product_name, quantity, quantity_unit, unit, category or "Other"),
                )
                inserted += 1

        if inserted == 0 and increased == 0:
            details = "; ".join(skipped_details[:8]) if skipped_details else "No valid items."
            return _error_response("insert", f"No valid items to insert. {details}")

        conn.commit()
        log.info(f"{log_id} Inserted {inserted}, increased {increased}, skipped {skipped}")
        return {
            "status": "success",
            "inserted": inserted,
            "increased": increased,
            "skipped": skipped,
            "processed": len(items),
        }
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("insert", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("insert", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def toggle_shopping_list_item(
    item_id: int,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Toggle the checked state of a shopping list item."""
    log_id = "[InventoryTools:toggle_shopping_list_item]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("update", "Missing db_path in tool_config.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT id, checked FROM shopping_list WHERE id = ?", (item_id,))
        row = cur.fetchone()
        if not row:
            return _error_response("update", f"Shopping list item id={item_id} not found.")
        new_checked = 0 if row["checked"] else 1
        cur.execute(
            "UPDATE shopping_list SET checked = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_checked, item_id),
        )
        conn.commit()
        log.info(f"{log_id} Toggled id={item_id} checked={new_checked}")
        return {"status": "success", "id": item_id, "checked": new_checked}
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("update", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("update", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def delete_shopping_list_item(
    item_id: int,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Remove a single item from the shopping list."""
    log_id = "[InventoryTools:delete_shopping_list_item]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("delete", "Missing db_path in tool_config.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        cur = conn.cursor()
        cur.execute("DELETE FROM shopping_list WHERE id = ?", (item_id,))
        if cur.rowcount == 0:
            return _error_response("delete", f"Shopping list item id={item_id} not found.")
        conn.commit()
        log.info(f"{log_id} Deleted id={item_id}")
        return {"status": "success", "deleted": 1, "id": item_id}
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("delete", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("delete", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def clear_checked_shopping_list_items(
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Remove all checked items from the shopping list."""
    log_id = "[InventoryTools:clear_checked_shopping_list_items]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return _error_response("delete", "Missing db_path in tool_config.")

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_sqlite(db_path)
        cur = conn.cursor()
        cur.execute("DELETE FROM shopping_list WHERE checked = 1")
        count = cur.rowcount
        conn.commit()
        log.info(f"{log_id} Cleared {count} checked items")
        return {"status": "success", "deleted": count}
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return _error_response("delete", f"SQLite error: {e}")
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return _error_response("delete", f"Unexpected error: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass
