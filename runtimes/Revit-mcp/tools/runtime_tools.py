"""Foundation tools that do not mutate a Revit document."""

from config import RUNTIME_NAME
from connection.bridge import get_active_document, get_documents, health_check, get_native_operation_status


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
    def revit_save_model(dry_run: bool = False, document_id: str = None) -> dict:
        """Save current bound model to existing path (not Save As).

        Dry run inspects save target without mutating. A committed save
        modifies persistent model file; operation outcome must be verified.
        """
        from connection.bridge import save_model
        return save_model(dry_run, document_id)

    @mcp.tool()
    def revit_get_runtime_info() -> dict:
        """Return runtime, bridge, and open-document diagnostics without mutation."""

        return get_runtime_info()

    @mcp.tool()
    def revit_get_operation_status(operation_id: str) -> dict:
        """Read a Native operation phase without dispatching into the Revit UI thread.

        Use after HTTP 504 or an unknown-outcome side effect; this must never
        replay the original operation. A missing record is NOT proof of failure.
        """
        return get_native_operation_status(operation_id)
