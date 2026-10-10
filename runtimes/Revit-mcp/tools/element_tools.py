"""Element MCP tools."""

from services.element_service import count_or_group_elements, get_element_by_id, list_elements


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
            parameters: At most 16 exact parameter display names per element.
                Results show OK/MISSING/AMBIGUOUS and instance-first, type-fallback
                scope. Doubles carry raw Revit internal units plus formatted display.

        Returns element IDs, category, family/type and optional selected parameter metadata.
        No values are returned for ambiguous duplicate parameter names.
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
    def revit_get_element(
        element_id: str,
        document_id: str = None,
        parameters: list[str] = None,
    ) -> dict:
        """Get one element with optional requested parameter metadata.

        Args:
            element_id: The Revit element ID as a string.
            document_id: Optional document ID; current bound model by default.
            parameters: At most 16 exact parameter display names to read.
                Parameters are instance-first, with type fallback when absent.
                Duplicates are marked AMBIGUOUS; missing ones marked MISSING.

        Values include storage type, raw internal unit and formatted display.
        """
        return get_element_by_id(element_id, document_id, parameters=parameters)
    @mcp.tool()
    def revit_count_elements(
        document_id: str = None, category: str = None, class_name: str = None,
        family: str = None, type_name: str = None, view_id: str = None,
    ) -> dict:
        """Count actual placed elements in one native Revit API request; no list-size limit."""
        return count_or_group_elements(document_id, category, class_name, family,
                                       type_name, view_id)

    @mcp.tool()
    def revit_group_elements(
        group_by: str, document_id: str = None, category: str = None,
        class_name: str = None, family: str = None, type_name: str = None,
        view_id: str = None,
    ) -> dict:
        """Count actual placed elements grouped by category, family, type, or level."""
        return count_or_group_elements(document_id, category, class_name, family,
                                       type_name, view_id, group_by)
