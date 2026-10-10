"""Bound model Revit UI selection/navigation, no document writes."""
from connection.bridge import activate_view, get_selection, set_selection, show_elements


def register(mcp) -> None:
    @mcp.tool()
    def revit_get_selection(document_id: str = None) -> dict:
        """Read selected element IDs in the currently active bound Revit model."""
        return get_selection(document_id=document_id)

    @mcp.tool()
    def revit_set_selection(element_ids: list[str], document_id: str = None) -> dict:
        """Replace selected element IDs (empty list clears). UI only; no model edits."""
        return set_selection(element_ids, document_id=document_id)

    @mcp.tool()
    def revit_show_elements(element_ids: list[str], document_id: str = None) -> dict:
        """Zoom/show at least one existing element in the active bound Revit model."""
        return show_elements(element_ids, document_id=document_id)

    @mcp.tool()
    def revit_activate_view(view_id: str, document_id: str = None) -> dict:
        """Switch active Revit UI view within the currently bound document; no auto-rebind."""
        return activate_view(view_id, document_id=document_id)
