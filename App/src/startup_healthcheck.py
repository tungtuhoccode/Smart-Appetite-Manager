"""
Startup health checks for Smart Appetite Manager.

Runs a one-time, informational startup report covering tool imports,
required environment variables, database readiness, and external API checks.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

if callable(load_dotenv):
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        load_dotenv()

log = logging.getLogger(__name__)

_REQUIRED_ENV_VARS = (
    "LLM_SERVICE_API_KEY",
    "SPOONACULAR_API_KEY",
    "SERPAPI_KEY",
    "INVENTORY_MANAGER_DB_NAME",
)

_TOOL_FUNCTIONS = {
    "recipe_agent.mealdb_tools": (
        "get_top_3_meals",
        "search_meals",
        "get_meal_details",
        "get_random_meal",
    ),
    "inventory_agent.inventory_manager_tools": (
        "list_inventory_items",
        "insert_inventory_items",
        "increase_inventory_stock",
        "decrease_inventory_stock",
        "delete_inventory_item",
    ),
    "shopper_agent.grocery_tools": (
        "check_local_flyers",
        "get_standard_price",
        "find_best_deals_batch",
    ),
    "receipt_agent.receipt_tools": ("parse_receipt_text",),
}


@dataclass(frozen=True)
class CheckResult:
    name: str
    status: str  # pass | warn | fail
    message: str

    def as_dict(self) -> Dict[str, str]:
        return {"name": self.name, "status": self.status, "message": self.message}


def _is_truthy(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _http_get_json(url: str, timeout_seconds: float = 10.0) -> Any:
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        snippet = body[:300] if body else "No response body."
        raise RuntimeError(f"HTTP {e.code}: {snippet}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error: {getattr(e, 'reason', e)}") from e
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Invalid JSON response: {e}") from e


def _check_required_env_vars() -> CheckResult:
    missing = [name for name in _REQUIRED_ENV_VARS if not (os.getenv(name) or "").strip()]
    if missing:
        return CheckResult(
            name="Environment Variables",
            status="fail",
            message=f"Missing required variables: {', '.join(missing)}",
        )
    return CheckResult(
        name="Environment Variables",
        status="pass",
        message="All required variables are present.",
    )


def _resolve_inventory_db_path() -> Path:
    configured = (os.getenv("INVENTORY_MANAGER_DB_NAME") or "inventory.db").strip()
    db_path = Path(configured)
    if not db_path.is_absolute():
        db_path = (Path.cwd() / db_path).resolve()
    return db_path


def _check_inventory_database() -> CheckResult:
    db_path = _resolve_inventory_db_path()
    if not db_path.exists():
        return CheckResult(
            name="Inventory Database",
            status="warn",
            message=(
                f"DB file not found at {db_path}. "
                "It will be created automatically when inventory tools run."
            ),
        )

    conn: Optional[sqlite3.Connection] = None
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='inventory' LIMIT 1"
        )
        has_inventory_table = cur.fetchone() is not None
        if has_inventory_table:
            return CheckResult(
                name="Inventory Database",
                status="pass",
                message=f"SQLite reachable and inventory table found ({db_path}).",
            )
        return CheckResult(
            name="Inventory Database",
            status="warn",
            message=(
                f"SQLite reachable but table 'inventory' is missing ({db_path}). "
                "It will be created automatically on inventory tool use."
            ),
        )
    except sqlite3.Error as e:
        return CheckResult(
            name="Inventory Database",
            status="fail",
            message=f"SQLite connection failed ({db_path}): {e}",
        )
    finally:
        if conn:
            conn.close()


def _check_tool_imports() -> List[CheckResult]:
    results: List[CheckResult] = []
    for module_name, function_names in _TOOL_FUNCTIONS.items():
        module = None
        import_errors: List[str] = []
        import_candidates = (module_name, f"src.{module_name}")
        for candidate in import_candidates:
            try:
                module = importlib.import_module(candidate)
                break
            except Exception as e:
                import_errors.append(f"{candidate}: {e}")

        if module is None:
            results.append(
                CheckResult(
                    name=f"Tool Module: {module_name}",
                    status="fail",
                    message=f"Import failed: {' | '.join(import_errors)}",
                )
            )
            continue

        missing = [
            func_name
            for func_name in function_names
            if not callable(getattr(module, func_name, None))
        ]
        if missing:
            results.append(
                CheckResult(
                    name=f"Tool Module: {module_name}",
                    status="fail",
                    message=f"Missing/un-callable functions: {', '.join(missing)}",
                )
            )
            continue

        results.append(
            CheckResult(
                name=f"Tool Module: {module_name}",
                status="pass",
                message=f"Imported and validated {len(function_names)} function(s).",
            )
        )
    return results


def _check_spoonacular_api(network_enabled: bool) -> CheckResult:
    api_key = (os.getenv("SPOONACULAR_API_KEY") or "").strip()
    if not api_key:
        return CheckResult(
            name="Spoonacular API",
            status="fail",
            message="SPOONACULAR_API_KEY is missing.",
        )
    if not network_enabled:
        return CheckResult(
            name="Spoonacular API",
            status="warn",
            message="Skipped (STARTUP_HEALTHCHECK_NETWORK=false).",
        )

    params = urllib.parse.urlencode({"apiKey": api_key, "number": 1})
    url = f"https://api.spoonacular.com/recipes/random?{params}"
    try:
        payload = _http_get_json(url, timeout_seconds=12.0)
        if isinstance(payload, dict) and isinstance(payload.get("recipes"), list):
            return CheckResult(
                name="Spoonacular API",
                status="pass",
                message="Live API call succeeded.",
            )
        return CheckResult(
            name="Spoonacular API",
            status="fail",
            message="Unexpected response payload shape.",
        )
    except Exception as e:
        return CheckResult(
            name="Spoonacular API",
            status="fail",
            message=str(e),
        )


def _check_serpapi_api(network_enabled: bool) -> CheckResult:
    api_key = (os.getenv("SERPAPI_KEY") or "").strip()
    if not api_key:
        return CheckResult(
            name="SerpApi",
            status="fail",
            message="SERPAPI_KEY is missing.",
        )
    if not network_enabled:
        return CheckResult(
            name="SerpApi",
            status="warn",
            message="Skipped (STARTUP_HEALTHCHECK_NETWORK=false).",
        )

    url = f"https://serpapi.com/account.json?{urllib.parse.urlencode({'api_key': api_key})}"
    try:
        payload = _http_get_json(url, timeout_seconds=12.0)
        if isinstance(payload, dict) and payload.get("error"):
            return CheckResult(
                name="SerpApi",
                status="fail",
                message=f"API returned error: {payload.get('error')}",
            )
        if isinstance(payload, dict):
            return CheckResult(
                name="SerpApi",
                status="pass",
                message="Live API call succeeded.",
            )
        return CheckResult(
            name="SerpApi",
            status="fail",
            message="Unexpected response payload shape.",
        )
    except Exception as e:
        return CheckResult(name="SerpApi", status="fail", message=str(e))


def run_startup_health_checks(logger: Optional[logging.Logger] = None) -> Dict[str, Any]:
    """
    Run startup health checks and log informational status output.

    Controlled by:
    - STARTUP_HEALTHCHECK_ENABLED (default: true)
    - STARTUP_HEALTHCHECK_NETWORK (default: true)
    """
    active_logger = logger or log
    enabled = _is_truthy(os.getenv("STARTUP_HEALTHCHECK_ENABLED"), default=True)
    if not enabled:
        active_logger.info(
            "[StartupCheck] Skipped (STARTUP_HEALTHCHECK_ENABLED=false)."
        )
        return {
            "enabled": False,
            "status": "warn",
            "counts": {"pass": 0, "warn": 1, "fail": 0},
            "results": [
                {
                    "name": "Startup Health Checks",
                    "status": "warn",
                    "message": "Disabled by STARTUP_HEALTHCHECK_ENABLED=false",
                }
            ],
        }

    network_enabled = _is_truthy(os.getenv("STARTUP_HEALTHCHECK_NETWORK"), default=True)
    results: List[CheckResult] = []
    results.append(_check_required_env_vars())
    results.extend(_check_tool_imports())
    results.append(_check_inventory_database())
    results.append(_check_spoonacular_api(network_enabled))
    results.append(_check_serpapi_api(network_enabled))

    pass_count = sum(1 for r in results if r.status == "pass")
    warn_count = sum(1 for r in results if r.status == "warn")
    fail_count = sum(1 for r in results if r.status == "fail")
    overall_status = "fail" if fail_count else ("warn" if warn_count else "pass")

    active_logger.info("[StartupCheck] ===== Integration Health Check =====")
    for result in results:
        line = f"[StartupCheck] [{result.status.upper():4}] {result.name}: {result.message}"
        if result.status == "pass":
            active_logger.info(line)
        elif result.status == "warn":
            active_logger.warning(line)
        else:
            active_logger.error(line)
    active_logger.info(
        "[StartupCheck] Summary: %s (%d pass, %d warn, %d fail)",
        overall_status.upper(),
        pass_count,
        warn_count,
        fail_count,
    )

    return {
        "enabled": True,
        "status": overall_status,
        "counts": {"pass": pass_count, "warn": warn_count, "fail": fail_count},
        "results": [r.as_dict() for r in results],
    }
