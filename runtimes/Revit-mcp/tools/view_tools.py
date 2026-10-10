"""View and level MCP tools."""

from services.view_service import list_levels, list_views
from connection.bridge import get_view_properties, list_view_filters, manage_view_filters, create_or_duplicate_view


def register(mcp) -> None:
    @mcp.tool()
    def revit_create_or_duplicate_view(action: str, name: str = None,
                                       level_id: str = None,
                                       source_view_id: str = None,
                                       view_family_type_id: str = None,
                                       document_id: str = None) -> dict:
        """Create floor/ceiling plan or 3D isometric view, or duplicate existing view.

        Simple Revit 2024 supported cases only; needs exact Native write approval.
        """
        return create_or_duplicate_view(action, name, level_id, source_view_id,
                                        view_family_type_id, document_id)

    @mcp.tool()
    def revit_list_view_filters(view_id: str, document_id: str = None) -> dict:
        """List existing view parameter filters with attached/visibility status."""
        return list_view_filters(view_id, document_id)

    @mcp.tool()
    def revit_manage_view_filters(view_id: str, filter_id: str, action: str,
                                  visible: bool = None, document_id: str = None) -> dict:
        """Attach/remove/show/hide an existing Revit ParameterFilterElement.

        Creating/editing rule definitions is NOT supported by this handler.
        Requires exact Native approval on a disposable test RVT.
        """
        return manage_view_filters(view_id, filter_id, action, visible, document_id)

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
    @mcp.tool()
    def revit_get_view_properties(view_id: str, document_id: str = None) -> dict:
        """Read view presentation properties, scale, template, detail, crop and display style."""
        return get_view_properties(view_id, document_id=document_id)
