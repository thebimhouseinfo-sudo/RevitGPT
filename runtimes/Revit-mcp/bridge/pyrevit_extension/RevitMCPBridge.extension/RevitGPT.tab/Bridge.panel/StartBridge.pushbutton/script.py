#! python3
"""Manual RevitGPT bridge status/start button."""

import os
import sys

from pyrevit import script

extension_dir = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
contents_dir = os.path.join(
    extension_dir,
    "RevitMCPBridge.bundle",
    "Contents",
)
if contents_dir not in sys.path:
    sys.path.insert(0, contents_dir)

logger = script.get_logger()

try:
    import revit_mcp_bridge

    state = revit_mcp_bridge.ensure_server_started()
    if state.get("ready"):
        script.print_md(
            "**RevitGPT Bridge READY** on http://127.0.0.1:{}".format(state["port"])
        )
    else:
        script.print_md(
            "**RevitGPT Bridge NOT READY**: {}".format(
                state.get("error") or state
            )
        )
except Exception as exc:
    logger.error("RevitGPT Bridge error: {}".format(exc))
    raise
