#! python3
"""Auto-start RevitGPT bridge when pyRevit loads/reloads."""

import json
import os
import sys
import traceback
from datetime import datetime

extension_dir = os.path.dirname(os.path.abspath(__file__))
contents_dir = os.path.join(
    extension_dir,
    "RevitMCPBridge.bundle",
    "Contents",
)
if contents_dir not in sys.path:
    sys.path.insert(0, contents_dir)

_appdata_root = os.getenv("REVITGPT_APPDATA_ROOT") or os.path.join(
    os.getenv("LOCALAPPDATA") or os.path.expanduser("~"), "RevitGPT"
)
_startup_log_path = os.path.join(_appdata_root, "logs", "bridge-startup.ndjson")


def _startup_log(event, **fields):
    try:
        log_dir = os.path.dirname(_startup_log_path)
        if not os.path.isdir(log_dir):
            os.makedirs(log_dir)
        record = {"timestamp": datetime.utcnow().isoformat() + "Z", "event": event}
        record.update(fields)
        with open(_startup_log_path, "a") as stream:
            stream.write(json.dumps(record, default=str) + "\n")
    except Exception:
        pass


_startup_log("startup_begin", extension_dir=extension_dir)

try:
    import revit_mcp_bridge

    result = revit_mcp_bridge.ensure_server_started()
    if result.get("ready") and result.get("running"):
        _startup_log("startup_complete", result=result)
    else:
        _startup_log("startup_failed", reason="bridge_not_ready", result=result)
except Exception as exc:
    _startup_log(
        "startup_failed",
        error=str(exc),
        traceback=traceback.format_exc(),
    )
    # Startup must never block Revit itself.
    print("RevitGPT bridge startup failed: {}".format(exc))
