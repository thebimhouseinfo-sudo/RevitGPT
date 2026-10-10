"""Typed architectural creation; all mutations require exact native approval."""
from connection.bridge import create_architecture


def register(mcp) -> None:
    @mcp.tool()
    def revit_create_architecture(action: str, properties: dict,
                                  document_id: str = None) -> dict:
        """Create wall, level, grid or model line in Revit internal feet.

        Supported simple geometry only; unsupported shapes are refused.
        Native permits one-time approved edits to disposable fixtures only.
        """
        return create_architecture(action, properties, document_id)
