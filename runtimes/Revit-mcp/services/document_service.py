"""Document operations via the Revit bridge."""

from connection.bridge import get_active_document, get_documents


def get_active_doc() -> dict:
    """Get metadata about the active Revit document."""
    return get_active_document()


def list_documents() -> list[dict]:
    """Get all open Revit documents."""
    return get_documents()
