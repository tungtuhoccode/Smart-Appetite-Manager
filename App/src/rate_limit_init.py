"""
LLM call rate-limiting init hook for SAM agents.

Usage in agent YAML (under app_config):
  agent_init_function:
    module: "rate_limit_init"
    name: "setup_llm_rate_limit"
    base_path: "src"
    config:
      wait_seconds: ${LLM_MIN_CALL_INTERVAL_SECONDS, 1.0}
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

log = logging.getLogger(__name__)
_STARTUP_CHECK_LOCK = threading.Lock()
_STARTUP_CHECK_RAN = False


@dataclass
class RateLimitConfig:
    wait_seconds: float = 1.0


def _run_startup_health_checks_once() -> None:
    global _STARTUP_CHECK_RAN
    with _STARTUP_CHECK_LOCK:
        if _STARTUP_CHECK_RAN:
            return
        _STARTUP_CHECK_RAN = True

    try:
        try:
            from startup_healthcheck import run_startup_health_checks
        except ImportError:  # pragma: no cover
            from src.startup_healthcheck import run_startup_health_checks
        run_startup_health_checks(logger=log)
    except Exception as e:  # pragma: no cover
        log.warning("[StartupCheck] Health check bootstrap failed: %s", e, exc_info=True)


def setup_llm_rate_limit(host_component: Any, config: Optional[Any] = None) -> None:
    """
    Register a before-model callback that enforces a minimum delay between LLM calls.

    The limiter is process-local to this agent instance and thread-safe.
    """
    _run_startup_health_checks_once()

    raw_wait = getattr(config, "wait_seconds", None)
    if raw_wait is None and isinstance(config, dict):
        raw_wait = config.get("wait_seconds")
    wait_seconds = 1.0 if raw_wait is None else float(raw_wait)
    if wait_seconds < 0:
        wait_seconds = 0.0

    lock = threading.Lock()
    state = {"last_call_at": 0.0}
    existing_callback = getattr(
        host_component, "_inject_gateway_instructions_callback", None
    )
    log_id = f"[RateLimitInit:{host_component.get_config('agent_name', 'unknown')}]"

    def throttled_callback(callback_context: Any, llm_request: Any) -> Any:
        with lock:
            now = time.monotonic()
            elapsed = now - state["last_call_at"]
            remaining = wait_seconds - elapsed
            if remaining > 0:
                time.sleep(remaining)
            state["last_call_at"] = time.monotonic()

        if callable(existing_callback):
            return existing_callback(callback_context, llm_request)
        return None

    host_component._inject_gateway_instructions_callback = throttled_callback
    log.info(
        "%s Enabled LLM min-call-interval limiter: %.3fs",
        log_id,
        wait_seconds,
    )
