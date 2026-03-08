"""Structured JSONL logger for tool execution tracing."""

from __future__ import annotations

import inspect
import json
import os
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Optional

_WRITE_LOCK = threading.Lock()
_BASE_DIR = Path(__file__).resolve().parents[1]
_DEFAULT_LOG_PATH = _BASE_DIR / "monitoring" / "log.jsonl"
_SENSITIVE_TOKENS = ("key", "token", "secret", "password", "authorization")


def _resolve_log_path() -> Path:
    raw = os.getenv("TOOL_LOG_JSONL_PATH", "").strip()
    if not raw:
        return _DEFAULT_LOG_PATH
    path = Path(raw)
    if not path.is_absolute():
        return (_BASE_DIR / path).resolve()
    return path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_sensitive_key(key: str) -> bool:
    lower = key.lower()
    return any(token in lower for token in _SENSITIVE_TOKENS)


def _sanitize(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "<max_depth>"

    if value is None or isinstance(value, (bool, int, float)):
        return value

    if isinstance(value, str):
        if len(value) > 2000:
            return value[:2000] + "...<truncated>"
        return value

    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for idx, (key, item) in enumerate(value.items()):
            if idx >= 200:
                out["<truncated_keys>"] = f"{len(value) - 200} more keys"
                break
            key_str = str(key)
            if _is_sensitive_key(key_str):
                out[key_str] = "<redacted>"
            else:
                out[key_str] = _sanitize(item, depth + 1)
        return out

    if isinstance(value, (list, tuple, set)):
        seq = list(value)
        out = [_sanitize(item, depth + 1) for item in seq[:200]]
        if len(seq) > 200:
            out.append(f"<truncated_items:{len(seq) - 200}>")
        return out

    return repr(value)


def _write_event(event: Dict[str, Any]) -> None:
    path = _resolve_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(event, ensure_ascii=False)
    with _WRITE_LOCK:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
            os.fsync(handle.fileno())


def _log_start(tool_name: str, inputs: Dict[str, Any]) -> tuple[str, float]:
    call_id = str(uuid.uuid4())
    started = time.perf_counter()
    _write_event(
        {
            "ts": _now_iso(),
            "event": "tool_start",
            "tool": tool_name,
            "call_id": call_id,
            "pid": os.getpid(),
            "inputs": _sanitize(inputs),
        }
    )
    return call_id, started


def _log_end(tool_name: str, call_id: str, started: float, result: Any) -> None:
    duration_ms = round((time.perf_counter() - started) * 1000, 3)
    _write_event(
        {
            "ts": _now_iso(),
            "event": "tool_end",
            "tool": tool_name,
            "call_id": call_id,
            "pid": os.getpid(),
            "duration_ms": duration_ms,
            "result": _sanitize(result),
        }
    )


def _log_error(tool_name: str, call_id: str, started: float, error: Exception) -> None:
    duration_ms = round((time.perf_counter() - started) * 1000, 3)
    _write_event(
        {
            "ts": _now_iso(),
            "event": "tool_error",
            "tool": tool_name,
            "call_id": call_id,
            "pid": os.getpid(),
            "duration_ms": duration_ms,
            "error_type": type(error).__name__,
            "error": str(error),
            "traceback": traceback.format_exc(),
        }
    )


def logged_tool(tool_name: Optional[str] = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """
    Decorator to log tool execution start/end/error into JSONL.
    Works for both async and sync functions.
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        resolved_name = tool_name or f"{func.__module__}.{func.__name__}"
        signature = inspect.signature(func)

        def _bound_inputs(args: tuple[Any, ...], kwargs: Dict[str, Any]) -> Dict[str, Any]:
            try:
                bound = signature.bind_partial(*args, **kwargs)
                bound.apply_defaults()
                data = dict(bound.arguments)
            except Exception:
                data = {"args": args, "kwargs": kwargs}

            # Tool context objects are often noisy/unserializable.
            data.pop("tool_context", None)
            return data

        if inspect.iscoroutinefunction(func):

            @wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                call_id, started = _log_start(resolved_name, _bound_inputs(args, kwargs))
                try:
                    result = await func(*args, **kwargs)
                    _log_end(resolved_name, call_id, started, result)
                    return result
                except Exception as exc:  # pragma: no cover - re-raised
                    _log_error(resolved_name, call_id, started, exc)
                    raise

            return async_wrapper

        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            call_id, started = _log_start(resolved_name, _bound_inputs(args, kwargs))
            try:
                result = func(*args, **kwargs)
                _log_end(resolved_name, call_id, started, result)
                return result
            except Exception as exc:  # pragma: no cover - re-raised
                _log_error(resolved_name, call_id, started, exc)
                raise

        return sync_wrapper

    return decorator

