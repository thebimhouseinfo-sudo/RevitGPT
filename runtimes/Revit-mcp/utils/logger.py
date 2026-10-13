"""Structured Revit MCP runtime logging into RevitGPT AppData."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _appdata_root() -> Path:
    configured = os.getenv("REVITGPT_APPDATA_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    local = os.getenv("LOCALAPPDATA", "").strip()
    if local:
        return Path(local) / "RevitGPT"
    return Path.home() / ".local" / "share" / "RevitGPT"


def append_log(filename: str, event: str, **fields: Any) -> None:
    try:
        target = _appdata_root() / "logs" / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **fields,
        }
        with target.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    except Exception:
        # Logging must never break a Revit operation.
        pass


def log_runtime(event: str, **fields: Any) -> None:
    append_log("revit-mcp.ndjson", event, **fields)
