"""Document MCP tools."""

from services.document_service import get_active_doc, list_documents


def register(mcp) -> None:
    @mcp.tool()
    def revit_get_active_document() -> dict:
        """Get metadata about the active Revit document.

        Returns document title, path, worksharing status, and Revit version.
        """
        return get_active_doc()

    @mcp.tool()
    def revit_list_documents() -> list[dict]:
        """List all open Revit documents.

        Returns a list of document metadata including title and ID.
        """
        return list_documents()
