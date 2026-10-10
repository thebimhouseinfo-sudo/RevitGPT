"""Element MCP tools."""

from services.element_service import count_or_group_elements, get_element_by_id, list_elements
from connection.bridge import query_elements,
     get_spatial_warnings, get_element_parameters, inspect_element, get_categories


def register(mcp) -> None:
    @mcp.tool()
    def revit_query_elements(category: str = None, family: str = None,
                             type_name: str = None, class_name: str = None,
                             predicate: dict = None, page_size: int = 100,
                             after_id: str = None, document_id: str = None) -> dict:
        """Query model elements with bounded keyset pages and typed predicates.

        Results are NOT a frozen model snapshot; restart if RVT changes.
        """
        return query_elements(category, family, type_name, class_name,
                              predicate, page_size, after_id, document_id)

    @mcp.tool()
    def revit_get_categories(document_id: str = None,
                             name_contains: str = None) -> list[dict]:
        """Read Revit category IDs, names, types and binding support."""
        return get_categories(document_id=document_id, name_contains=name_contains)

    @mcp.tool()
    def revit_get_geometry_summary(element_id: str, document_id: str = None) -> dict:
        """Read element native geometry location/bounding box without any model write."""
        return inspect_element(element_id, "geometry", document_id)

    @mcp.tool()
    def revit_get_element_relationships(element_id: str, document_id: str = None) -> dict:
        """Read element type/level/group/host/link relations in bound Revit model."""
        return inspect_element(element_id, "relationships", document_id)

    @mcp.tool()
    def revit_get_parameters(element_id: str, document_id: str = None,
                             include_type: bool = True) -> dict:
        """Inspect all instance and optionally type parameter metadata for one Revit element."""
        return get_element_parameters(element_id, document_id, include_type)

    @mcp.tool()
    def revit_list_parameters(element_id: str, document_id: str = None,
                              include_type: bool = True) -> dict:
        """List exact instance/type parameter names and identifiers without guessing duplicates."""
        return get_element_parameters(element_id, document_id, include_type)

    @mcp.tool()
    def revit_query_spatial_and_warnings(document_id: str = None,
                                         include_warnings: bool = True) -> dict:
        """Read room/space/grid inventory and documented Revit model warnings."""
        return get_spatial_warnings(document_id=document_id,
                                    include_warnings=include_warnings)

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
