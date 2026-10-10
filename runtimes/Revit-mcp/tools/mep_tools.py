"""MEP operation MCP tools."""

from services.mep_service import (
    create_duct_run,
    create_pipe_run,
    delete,
    get_connectors,
    move,
    place_instance,
    set_element_parameter,
)


from connection.bridge import get_mep_systems, get_mep_quantities


def register(mcp) -> None:
    @mcp.tool()
    def revit_quantity_takeoff(category: str = None,
                              document_id: str = None) -> dict:
        """MEP instance quantities by category/family/type and measured straight duct/pipe length."""
        return get_mep_quantities(mode="all", category=category, document_id=document_id)

    @mcp.tool()
    def revit_summarize_equipment(document_id: str = None) -> dict:
        """Mechanical Equipment instance counts grouped by family and type."""
        return get_mep_quantities(mode="equipment", document_id=document_id)

    @mcp.tool()
    def revit_list_mep_systems(kind: str = None, document_id: str = None) -> list[dict]:
        """List actual Revit MechanicalSystem/PipingSystem instances and member counts, not types."""
        return get_mep_systems(kind=kind, document_id=document_id)

    @mcp.tool()
    def revit_get_connectors(
        element_id: str,
        document_id: str = None,
    ) -> list[dict]:
        """Get MEP connectors of an element (equipment, fittings, etc.).

        Args:
            element_id: The Revit element ID (as string).
            document_id: Optional document ID. Uses active document if not provided.

        Returns a list of connectors with their ID, type, direction, coordinate,
        and references to other connected elements.
        Use this to understand how MEP elements are connected.
        """
        return get_connectors(element_id, document_id)

    @mcp.tool()
    def revit_place_family_instance(
        family: str,
        type: str,
        x: float,
        y: float,
        z: float = 0,
        level_id: str = None,
        rotation: float = 0,
        document_id: str = None,
    ) -> dict:
        """Place a family instance (MEP equipment, fixture, etc.) in the model.

        All coordinates are in Revit internal units (feet).

        Args:
            family: Family name (e.g., "AHU", "FCU", "Sink").
            type: Type name within the family (e.g., "AHU-01", "36x24").
            x: X coordinate in feet.
            y: Y coordinate in feet.
            z: Z coordinate in feet (default 0).
            level_id: Optional level ID to place on. Uses first level if not provided.
            rotation: Rotation angle in radians (default 0).
            document_id: Optional document ID. Uses active document if not provided.

        Returns the placed element with its ID, category, family, type, and location.
        The operation is wrapped in a Revit transaction.
        """
        return place_instance(
            family=family,
            type=type,
            x=x,
            y=y,
            z=z,
            level_id=level_id,
            rotation=rotation,
            document_id=document_id,
        )

    @mcp.tool()
    def revit_create_duct(
        start_x: float,
        start_y: float,
        start_z: float,
        end_x: float,
        end_y: float,
        end_z: float,
        width: float = 0.3,
        height: float = 0.15,
        duct_type: str = None,
        system_type: str = None,
        level_id: str = None,
        document_id: str = None,
    ) -> dict:
        """Create a duct run between two points.

        All coordinates and dimensions are in Revit internal units (feet).

        Args:
            start_x: Start X coordinate in feet.
            start_y: Start Y coordinate in feet.
            start_z: Start Z coordinate in feet.
            end_x: End X coordinate in feet.
            end_y: End Y coordinate in feet.
            end_z: End Z coordinate in feet.
            width: Duct width in feet (default 0.3m ~ 1ft).
            height: Duct height in feet (default 0.15m ~ 0.5ft).
            duct_type: Duct type name (e.g., "Default Duct"). Uses project default if not provided.
            system_type: System type name (e.g., "Supply Air"). Uses project default if not provided.
            level_id: Optional level ID.
            document_id: Optional document ID. Uses active document if not provided.

        Returns the created duct element with its ID and properties.
        The operation is wrapped in a Revit transaction.
        """
        return create_duct_run(
            start_x=start_x,
            start_y=start_y,
            start_z=start_z,
            end_x=end_x,
            end_y=end_y,
            end_z=end_z,
            width=width,
            height=height,
            duct_type=duct_type,
            system_type=system_type,
            level_id=level_id,
            document_id=document_id,
        )

    @mcp.tool()
    def revit_create_pipe(
        start_x: float,
        start_y: float,
        start_z: float,
        end_x: float,
        end_y: float,
        end_z: float,
        diameter: float = 0.05,
        pipe_type: str = None,
        system_type: str = None,
        level_id: str = None,
        document_id: str = None,
    ) -> dict:
        """Create a pipe run between two points.

        All coordinates and dimensions are in Revit internal units (feet).

        Args:
            start_x: Start X coordinate in feet.
            start_y: Start Y coordinate in feet.
            start_z: Start Z coordinate in feet.
            end_x: End X coordinate in feet.
            end_y: End Y coordinate in feet.
            end_z: End Z coordinate in feet.
            diameter: Pipe diameter in feet (default 0.05m ~ 0.164ft).
            pipe_type: Pipe type name (e.g., "Default Pipe"). Uses project default if not provided.
            system_type: System type name (e.g., "Domestic Cold Water"). Uses project default if not provided.
            level_id: Optional level ID.
            document_id: Optional document ID. Uses active document if not provided.

        Returns the created pipe element with its ID and properties.
        The operation is wrapped in a Revit transaction.
        """
        return create_pipe_run(
            start_x=start_x,
            start_y=start_y,
            start_z=start_z,
            end_x=end_x,
            end_y=end_y,
            end_z=end_z,
            diameter=diameter,
            pipe_type=pipe_type,
            system_type=system_type,
            level_id=level_id,
            document_id=document_id,
        )

    @mcp.tool()
    def revit_set_parameter(
        element_id: str,
        parameter: str,
        value: str,
        document_id: str = None,
    ) -> dict:
        """Set a parameter value on an element.

        Args:
            element_id: The Revit element ID (as string).
            parameter: Parameter name (e.g., "Width", "Height", "Diameter", "Comments").
            value: New value. String for text, number for numeric, element ID string for element links.
            document_id: Optional document ID. Uses active document if not provided.

        Returns the updated parameter info including element ID, parameter name, value, and storage type.
        The operation is wrapped in a Revit transaction.
        Read-only parameters will raise an error.
        """
        # Never coerce a text Mark or identifier (e.g. "0012") into a float.
        # Native checks exact StorageType and rejects incompatible values.
        converted = value
        return set_element_parameter(
            element_id=element_id,
            parameter=parameter,
            value=converted,
            document_id=document_id,
        )

    @mcp.tool()
    def revit_delete_elements(
        element_ids: list[str],
        document_id: str = None,
        confirm: bool = False,
        acknowledged_affected_ids: list[str] = None,
    ) -> dict:
        """Delete one or more elements from the model.

        Args:
            element_ids: List of element IDs to delete (as strings).
            document_id: Optional document ID. Uses active document if not provided.

        Default is a rollback-based impact preview; no element is committed.
        To commit, explicitly set confirm=True and provide the exact affected
        IDs from preview. A separate operation-scoped Native grant is mandatory.
        All-or-nothing transaction: no partial commits.
        """
        return delete(element_ids=element_ids, document_id=document_id,
                      confirm=confirm,
                      acknowledged_affected_ids=acknowledged_affected_ids)

    @mcp.tool()
    def revit_move_element(
        element_id: str,
        dx: float = 0,
        dy: float = 0,
        dz: float = 0,
        x: float = None,
        y: float = None,
        z: float = None,
        document_id: str = None,
    ) -> dict:
        """Move an element by offset or to an absolute position.

        All coordinates are in Revit internal units (feet).

        Use dx/dy/dz for relative movement, or x/y/z for absolute position.
        If x/y/z are provided, dx/dy/dz are ignored.

        Args:
            element_id: The Revit element ID (as string).
            dx: X offset in feet (default 0).
            dy: Y offset in feet (default 0).
            dz: Z offset in feet (default 0).
            x: Absolute X position in feet (optional).
            y: Absolute Y position in feet (optional).
            z: Absolute Z position in feet (optional).
            document_id: Optional document ID. Uses active document if not provided.

        Returns the moved element with its updated location.
        The operation is wrapped in a Revit transaction.
        """
        return move(
            element_id=element_id,
            dx=dx,
            dy=dy,
            dz=dz,
            x=x,
            y=y,
            z=z,
            document_id=document_id,
        )
