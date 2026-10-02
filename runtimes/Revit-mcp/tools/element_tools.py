"""Element MCP tools."""

from services.element_service import get_element_by_id, list_elements


def register(mcp) -> None:
    @mcp.tool()
    def revit_list_elements(
        document_id: str = None,
        category: str = None,
        class_name: str = None,
        family: str = None,
        type_name: str = None,
        view_id: str = None,
        parameters: list[str] = None,
    ) -> list[dict]:
        """List elements with optional filters.

        Args:
            document_id: Optional document ID. Uses active document if not provided.
            category: Filter by category name (e.g., "Walls", "Doors").
            class_name: Filter by Revit API class (e.g., "Wall", "FamilyInstance").
            family: Filter by family name.
            type_name: Filter by type name.
            view_id: Filter to elements visible in a specific view.
            parameters: List of parameter names to include in the response.

        Returns a list of elements with their ID, category, family, type, and requested parameters.
        """
        return list_elements(
            document_id=document_id,
            category=category,
            class_name=class_name,
            family=family,
            type_name=type_name,
            view_id=view_id,
            parameters=parameters,
        )

    @mcp.tool()
    def revit_get_element(element_id: str, document_id: str = None) -> dict:
        """Get a single element by its ID.

        Args:
            element_id: The Revit element ID (as string).
            document_id: Optional document ID. Uses active document if not provided.

        Returns the element with its properties and parameters.
        """
        return get_element_by_id(element_id, document_id)
