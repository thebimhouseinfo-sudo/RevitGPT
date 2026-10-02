"""Configuration for the Revit MCP runtime."""

import os


BRIDGE_URL = os.getenv("REVIT_BRIDGE_URL", "http://127.0.0.1:8765").rstrip("/")
BRIDGE_TIMEOUT_SECONDS = float(os.getenv("REVIT_BRIDGE_TIMEOUT_SECONDS", "3"))
RUNTIME_NAME = "revit-mcp"
