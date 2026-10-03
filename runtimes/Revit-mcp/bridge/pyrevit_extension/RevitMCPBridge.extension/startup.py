"""Auto-start RevitGPT bridge when pyRevit loads/reloads."""

import os
import sys

extension_dir = os.path.dirname(os.path.abspath(__file__))
contents_dir = os.path.join(
    extension_dir,
    "RevitMCPBridge.bundle",
    "Contents",
)
if contents_dir not in sys.path:
    sys.path.insert(0, contents_dir)

try:
    import revit_mcp_bridge
    revit_mcp_bridge.ensure_server_started()
except Exception as exc:
    # The bridge writes structured errors once imported. Startup must not block Revit.
    print("RevitGPT bridge startup failed: {}".format(exc))
