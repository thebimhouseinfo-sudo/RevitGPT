"""pyRevit script entry point - starts the HTTP bridge."""

import os
import sys
import threading
from pyrevit import script

bridge_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if bridge_dir not in sys.path:
    sys.path.insert(0, bridge_dir)

logger = script.get_logger()


def run_bridge():
    try:
        import revit_mcp_bridge
        revit_mcp_bridge.run_server()
    except Exception as e:
        logger.error("Bridge error: {}".format(e))


if not hasattr(run_bridge, '_thread') or not run_bridge._thread.is_alive():
    run_bridge._thread = threading.Thread(target=run_bridge)
    run_bridge._thread.daemon = True
    run_bridge._thread.start()
    script.print_md("**Revit MCP Bridge started** on http://127.0.0.1:8765")
else:
    script.print_md("**Revit MCP Bridge already running**")
