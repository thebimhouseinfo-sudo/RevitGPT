"""View and level operations via the Revit bridge."""

from connection.bridge import get_levels, get_views


def list_views(document_id: str | None = None) -> list[dict]:
    """Get views from the document."""
    return get_views(document_id)


def list_levels(document_id: str | None = None) -> list[dict]:
    """Get levels from the document."""
    return get_levels(document_id)
