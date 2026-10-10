"""Bound Revit transforms execute in native Revit Transactions."""
from connection.bridge import transform_elements


def register(mcp) -> None:
    @mcp.tool()
    def revit_transform_elements(
        action: str, element_ids: list[str],
        dx: float = 0, dy: float = 0, dz: float = 0,
        axis_start: dict = None, axis_end: dict = None,
        angle: float = None, new_type_id: str = None,
        document_id: str = None,
    ) -> dict:
        """Copy/rotate/change type for 1..50 elements atomically.

        Coordinates use Revit internal feet; rotation angle in radians.
        Writes require the current bound-model identity.
        """
        return transform_elements(
            action, element_ids, dx=dx, dy=dy, dz=dz,
            axis_start=axis_start, axis_end=axis_end,
            angle=angle, new_type_id=new_type_id, document_id=document_id,
        )
