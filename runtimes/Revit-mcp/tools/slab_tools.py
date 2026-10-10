"""Simple native floor and ceiling creation on the bound Revit model."""
from connection.bridge import create_slab


def register(mcp) -> None:
    @mcp.tool()
    def revit_create_slab(kind: str, level_id: str, type_id: str,
                          vertices: list[dict], document_id: str = None) -> dict:
        """Create a simple bounded horizontal floor or ceiling from a polygon.

        Each vertex uses Revit internal feet. Native validates the closed profile
        and transaction; the development version writes disposable models only.
        """
        return create_slab(kind, level_id, type_id, vertices, document_id)
