"""
Inventory manager tools for SAM agents.

Provides basic read/insert operations against a SQLite inventory database.
"""

import logging
import os
import sqlite3
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)


def _get_db_path(tool_config: Optional[Dict[str, Any]]) -> Optional[str]:
    if not tool_config:
        return None
    return tool_config.get("db_path")


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

        for item in items:
            product_name = _normalize_text(item.get("product_name"))
            if not product_name:
                skipped += 1
                continue

            try:
                quantity = _parse_quantity(item.get("quantity", 0), default=0.0)
            except (TypeError, ValueError):
                return _error_response(
                    "insert",
                    f"Invalid quantity for '{product_name}': {item.get('quantity')!r}",
                )

            quantity_unit = _normalize_text(item.get("quantity_unit"))
            unit = _normalize_text(item.get("unit"))

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

        existing = _find_existing_inventory_row(
            cur=cur,
            product_name=normalized_name,
            quantity_unit=normalized_quantity_unit,
            unit=normalized_unit,
        )
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
