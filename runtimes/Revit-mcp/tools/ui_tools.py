"""Bound model Revit UI selection/navigation, no document writes."""
from connection.bridge import activate_view, get_active_view, get_selection, set_selection, show_elements, temporary_visibility, select_related


def register(mcp) -> None:
    @mcp.tool()
    def revit_get_active_view(document_id: str = None) -> dict:
        """Read the actual active Revit UI tab/view in the currently bound model.

        Returns view_id, view_name, view_type and temporary visibility state.
        Use before a view-specific action when the user says 'current view'.
        Never guess the view from the last created/duplicated view.
        """
        return get_active_view(document_id=document_id)

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
                                   document_id: str = None, view_id: str = None,
                                   category: str = None) -> dict:
        """Temporarily hide/isolate elements in the ACTUAL active Revit view, or reset.

        Use category="duct" for ducts, duct fittings, duct accessories and flex
        ducts visible in the current view; category="pipe" similarly for pipes.
        Alternatively supply element_ids. These are mutually exclusive.
        view_id is optional; when supplied it MUST match the current active view
        (409 on tab switch), preventing changes to an unintended view.
        No model deletion; a Revit Transaction changes temporary view state.
        For persistent view visibility use revit_format_view instead.
        """
        return temporary_visibility(mode, element_ids, document_id,
                                    view_id=view_id, category=category)
    @mcp.tool()
    def revit_select_related(element_id: str, relation: str, apply: bool = False,
                             document_id: str = None) -> dict:
        """Preview or select one-hop hosted/host/connected elements in the bound Revit model."""
        return select_related(element_id, relation, apply, document_id)
