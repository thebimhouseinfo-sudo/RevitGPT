"""Document MCP tools."""

from services.document_service import get_active_doc, list_documents
from connection.bridge import read_model_anchor, initialize_model_anchor


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

    @mcp.tool()
    def revit_get_model_anchor(document_id: str = None) -> dict:
        """Read bound RVT's persistent RevitGPT_Model_ID from Project Information.

        Read only: does not create a shared parameter or modify the model.
        Missing or invalid ID is returned as evidence, never inferred from title/path.
        """
        return read_model_anchor(document_id)

    @mcp.tool()
    def revit_initialize_model_anchor(document_id: str = None) -> dict:
        """Explicitly initialize the bound project's missing RevitGPT_Model_ID.

        This mutates the model; use revit_save_model after successful initialization
        to persist the ID in RVT. Never reset existing IDs automatically.
        A copied/detached model requires an explicit identity decision.
        """
        return initialize_model_anchor(document_id)
