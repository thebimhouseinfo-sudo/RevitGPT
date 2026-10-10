"""Persistent view formatting, guarded by the Native one-time write coordinator."""
from connection.bridge import format_view


def register(mcp) -> None:
    @mcp.tool()
    def revit_format_view(view_id: str, action: str, properties: dict,
                          document_id: str = None) -> dict:
        """Set properties/crop/template/visibility/graphics of an existing view.

        This is a persistent RVT WRITE, not a UI action. The only editable
        model in development is a disposable fixture requiring pane approval.
        """
        return format_view(view_id, action, properties, document_id)
