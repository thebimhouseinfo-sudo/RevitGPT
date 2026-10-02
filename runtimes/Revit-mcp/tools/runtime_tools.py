"""Foundation tools that do not mutate a Revit document."""

from config import RUNTIME_NAME
from connection.bridge import health_check


def register(mcp) -> None:
    @mcp.tool()
    def revit_get_runtime_info() -> dict:
        """Return runtime and configured Revit bridge availability."""

        result = health_check()
        result["runtime"] = RUNTIME_NAME
        result["document_access"] = "not_implemented"
        return result
