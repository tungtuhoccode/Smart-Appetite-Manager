"""
Inventory manager tools for SAM agents.

Provides basic read/insert operations against a SQLite inventory database.
"""

import logging
import sqlite3
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)


def _get_db_path(tool_config: Optional[Dict[str, Any]]) -> Optional[str]:
    if not tool_config:
        return None
    return tool_config.get("db_path")


def _open_sqlite(db_path: str) -> sqlite3.Connection:
    # Use a short timeout to avoid hanging on locked DBs.
    return sqlite3.connect(db_path, timeout=10)


async def insert_inventory_items(
    items: List[Dict[str, Any]],
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Insert inventory rows into the inventory table.

    Each item should include: product_name, quantity, quantity_unit, unit.
    """
    log_id = "[InventoryTools:insert_inventory_items]"
    db_path = _get_db_path(tool_config)
    if not db_path:
        return {"status": "error", "message": "Missing db_path in tool_config."}

    if not items:
        return {"status": "error", "message": "No items provided."}

    try:
        conn = _open_sqlite(db_path)
        cur = conn.cursor()

        rows = []
        for item in items:
            rows.append(
                (
                    item.get("product_name"),
                    item.get("quantity", 0),
                    item.get("quantity_unit"),
                    item.get("unit"),
                )
            )

        cur.executemany(
            """
            INSERT INTO inventory (product_name, quantity, quantity_unit, unit)
            VALUES (?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
        inserted = cur.rowcount if cur.rowcount != -1 else len(rows)
        log.info(f"{log_id} Inserted {inserted} rows into inventory")
        return {"status": "success", "inserted": inserted}
    except sqlite3.Error as e:
        log.error(f"{log_id} SQLite error: {e}", exc_info=True)
        return {"status": "error", "message": f"SQLite error: {e}"}
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return {"status": "error", "message": f"Unexpected error: {e}"}
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
        return {"status": "error", "message": "Missing db_path in tool_config."}

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
        return {"status": "error", "message": f"SQLite error: {e}"}
    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return {"status": "error", "message": f"Unexpected error: {e}"}
    finally:
        try:
            conn.close()
        except Exception:
            pass
