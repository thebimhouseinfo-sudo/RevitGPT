"""Foundation tools that do not mutate a Revit document."""

from config import RUNTIME_NAME
from connection.bridge import get_active_document, get_documents, health_check


def get_runtime_info() -> dict:
    """Return non-mutating runtime, bridge, and open-document diagnostics."""

    result = health_check()
    result["runtime"] = RUNTIME_NAME

    if not result.get("available"):
        result["document_access"] = "unavailable"
        result["active_document"] = None
        result["open_documents"] = []
        return result

    try:
        result["active_document"] = get_active_document()
        result["open_documents"] = get_documents()
        result["document_access"] = "available"
    except Exception as exc:
        result["document_access"] = "error"
        result["document_error"] = repr(exc)
        result["active_document"] = None
        result["open_documents"] = []

    return result


def register(mcp) -> None:
    @mcp.tool()
    def revit_get_runtime_info() -> dict:
        """Return runtime, bridge, and open-document diagnostics without mutation."""

        return get_runtime_info()
