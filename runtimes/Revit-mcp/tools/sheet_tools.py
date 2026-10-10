"""Revit sheets and viewport tools, constrained by bound-model authorization."""
from connection.bridge import list_sheets, list_sheet_viewports, write_sheet


def register(mcp) -> None:
    @mcp.tool()
    def revit_list_sheets(document_id: str = None) -> list[dict]:
        """Read existing sheets and their placed views and viewport IDs."""
        return list_sheets(document_id)

    @mcp.tool()
    def revit_list_sheet_viewports(sheet_id: str,
                                   document_id: str = None) -> list[dict]:
        """Read the exact viewport IDs and placements on one sheet."""
        return list_sheet_viewports(sheet_id, document_id)

    @mcp.tool()
    def revit_manage_sheet(action: str, properties: dict,
                           document_id: str = None) -> dict:
        """Create a sheet or place/move/remove a viewport on a disposable RVT.

        Action create_sheet, place_viewport, move_viewport or remove_viewport.
        Transaction and exact per-call Native approval are mandatory.
        """
        return write_sheet(action, properties, document_id)
