"""Bound model Revit UI selection/navigation, no document writes."""
from connection.bridge import activate_view, get_selection, set_selection, show_elements, temporary_visibility, select_related


def register(mcp) -> None:
    @mcp.tool()
    def revit_get_selection(document_id: str = None) -> dict:
        """Read selected element IDs in the currently active bound Revit model."""
        return get_selection(document_id=document_id)

    @mcp.tool()
    def revit_set_selection(element_ids: list[str], document_id: str = None,
                            mode: str = "replace") -> dict:
        """Replace/add/remove/clear selected IDs in bound Revit UI, no RVT edits."""
        return set_selection(element_ids, document_id=document_id, mode=mode)

    @mcp.tool()
    def revit_show_elements(element_ids: list[str], document_id: str = None) -> dict:
        """Zoom/show at least one existing element in the active bound Revit model."""
        return show_elements(element_ids, document_id=document_id)

    @mcp.tool()
    def revit_activate_view(view_id: str, document_id: str = None) -> dict:
        """Switch active Revit UI view within the currently bound document; no auto-rebind."""
        return activate_view(view_id, document_id=document_id)
    @mcp.tool()
    def revit_temporary_visibility(mode: str, element_ids: list[str] = None,
                                   document_id: str = None) -> dict:
        """Temporarily hide/isolate selected elements or reset in current bound view.

        Revit uses a Transaction even though no persistent view design is intended.
        """
        return temporary_visibility(mode, element_ids, document_id)
    @mcp.tool()
    def revit_select_related(element_id: str, relation: str, apply: bool = False,
                             document_id: str = None) -> dict:
        """Preview or select one-hop hosted/host/connected elements in the bound Revit model."""
        return select_related(element_id, relation, apply, document_id)
