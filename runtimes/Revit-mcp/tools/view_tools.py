"""View and level MCP tools."""

from services.view_service import list_levels, list_views


def register(mcp) -> None:
    @mcp.tool()
    def revit_list_views(document_id: str = None) -> list[dict]:
        """List views in the active or specified Revit document.

        Args:
            document_id: Optional document ID. Uses active document if not provided.

        Returns a list of views with their ID, name, view type, and discipline.
        """
        return list_views(document_id)

    @mcp.tool()
    def revit_list_levels(document_id: str = None) -> list[dict]:
        """List levels in the active or specified Revit document.

        Args:
            document_id: Optional document ID. Uses active document if not provided.

        Returns a list of levels with their ID, name, and elevation.
        """
        return list_levels(document_id)
