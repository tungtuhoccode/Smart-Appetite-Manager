"""
Inventory manager tools for SAM agents.

Provides basic read/insert operations against a SQLite inventory database.
"""

import logging
import os
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple


log = logging.getLogger(__name__)


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

    return {
        "product_name": product_name,
        "quantity": quantity,
        "quantity_unit": quantity_unit,
        "unit": unit,
    }, None


def _find_existing_inventory_row(
    cur: sqlite3.Cursor,
    product_name: str,
    quantity_unit: Optional[str],
    unit: Optional[str],
) -> Optional[sqlite3.Row]:
    cur.execute(
        """
        SELECT id, product_name, quantity, quantity_unit, unit, created_at, updated_at
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
        SELECT id, product_name, quantity, quantity_unit, unit, created_at, updated_at
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

            existing = _find_existing_inventory_row(
                cur=cur,
                product_name=product_name,
                quantity_unit=quantity_unit,
                unit=unit,
            )
            if existing:
                current_quantity = _parse_quantity(existing["quantity"], default=0.0)
                new_quantity = current_quantity + quantity
                cur.execute(
                    """
                    UPDATE inventory
                    SET quantity = ?,
                        quantity_unit = COALESCE(?, quantity_unit),
                        unit = COALESCE(?, unit),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (new_quantity, quantity_unit, unit, existing["id"]),
                )
                increased += 1
                continue

            cur.execute(
                """
                INSERT INTO inventory (product_name, quantity, quantity_unit, unit)
                VALUES (?, ?, ?, ?)
                """,
                (product_name, quantity, quantity_unit, unit),
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


async def bulk_add_inventory_items(
    items: List[Dict[str, Any]],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Bulk-add multiple inventory items at once.

    Each item should include: product_name, quantity, quantity_unit, unit.
    If an item already exists (same product_name + quantity_unit + unit),
    quantity is increased instead of inserting a duplicate row.
    This is identical to insert_inventory_items but named explicitly for bulk operations.
    """
    return await insert_inventory_items(
        items=items, tool_context=tool_context, tool_config=tool_config
    )


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
            SELECT id, product_name, quantity, quantity_unit, unit, created_at, updated_at
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
