"""Manual RevitGPT bridge status/start button."""

import os
import sys
from pyrevit import script

contents_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if contents_dir not in sys.path:
    sys.path.insert(0, contents_dir)

logger = script.get_logger()

try:
    import revit_mcp_bridge
    state = revit_mcp_bridge.ensure_server_started()
    script.print_md("**Revit MCP Bridge running** on http://127.0.0.1:{}".format(state["port"]))
except Exception as exc:
    logger.error("Bridge error: {}".format(exc))
    raise
