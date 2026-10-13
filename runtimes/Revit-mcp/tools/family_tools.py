"""Family and type discovery MCP tools."""

from services.family_service import list_families, list_family_types, list_system_types
from connection.bridge import inspect_element


def register(mcp) -> None:
    @mcp.tool()
    def revit_inspect_family_instance(element_id: str, document_id: str = None) -> dict:
        """Inspect placed family host, type, level, parent and MEP connector count."""
        return inspect_element(element_id, "family", document_id)

    @mcp.tool()
    def revit_list_families(
        category: str = None,
        document_id: str = None,
    ) -> list[dict]:
        """List families loaded in the Revit project.

        Args:
            category: Filter by MEP category. Common values:
                "Mechanical Equipment", "Ducts", "Duct Fittings",
                "Pipes", "Pipe Fittings", "Plumbing Fixtures",
                "Lighting Fixtures", "Electrical Equipment",
                "Conduits", "Cable Trays", "Sprinklers".
            document_id: Optional document ID. Uses active document if not provided.

        Returns a list of families with their ID, name, category, and family file.
        """
        return list_families(document_id=document_id, category=category)

    @mcp.tool()
    def revit_list_family_types(
        family: str = None,
        category: str = None,
        document_id: str = None,
    ) -> list[dict]:
        """List family types (symbols) available in the project.

        Args:
            family: Filter by family name.
            category: Filter by MEP category name.
            document_id: Optional document ID. Uses active document if not provided.

        Returns a list of types with their ID, family name, type name, and category.
        Use this to find the exact family+type combination before placing an instance.
        """
        return list_family_types(family=family, category=category, document_id=document_id)

    @mcp.tool()
    def revit_list_system_types(
        classification: str = None,
        document_id: str = None,
    ) -> list[dict]:
        """List MEP system types in the project.

        Args:
            classification: Filter by system classification. Common values:
                "SupplyAir", "ReturnAir", "ExhaustAir",
                "HydronicSupply", "HydronicReturn",
                "DomesticColdWater", "DomesticHotWater", "Sanitary",
                "FireProtectWet", "PowerCircuit", "LightingCircuit".
            document_id: Optional document ID. Uses active document if not provided.

        Returns a list of system types with their ID, name, and classification.
        Use this when creating ducts or pipes to assign the correct system.
        """
        return list_system_types(classification=classification, document_id=document_id)
