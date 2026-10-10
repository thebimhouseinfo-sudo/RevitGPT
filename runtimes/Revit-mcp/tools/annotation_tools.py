"""Annotation MCP tools for Revit."""

from connection.bridge import update_annotation
from services.annotation_service import (
    add_detail_line,
    add_dimension,
    add_spot_elevation,
    add_tag,
    add_text_note,
    list_annotations,
)


def register(mcp) -> None:
    @mcp.tool()
    def revit_update_annotation(element_id: str, action: str,
                                text: str = None, has_leader: bool = None,
                                position: dict = None,
                                document_id: str = None) -> dict:
        """Edit TextNote text or IndependentTag leader/head in place.

        Requires exact Native one-shot approval on disposable fixture.
        """
        return update_annotation(element_id, action, text=text,
            has_leader=has_leader, position=position, document_id=document_id)

    @mcp.tool()
    def revit_list_annotations(
        view_id: str,
        annotation_type: str = None,
        document_id: str = None,
    ) -> list[dict]:
        """List annotations in a specific view.

        Args:
            view_id: The view ID to list annotations from.
            annotation_type: Filter by type. Values: "text", "tag", "dimension",
                "spot_elevation", "detail_line". If not provided, returns all types.
            document_id: Optional document ID. Uses active document if not provided.

        Returns a list of annotations with their ID, type, text/value, and location.
        """
        return list_annotations(view_id=view_id, annotation_type=annotation_type, document_id=document_id)

    @mcp.tool()
    def revit_create_text_note(
        view_id: str,
        text: str,
        x: float,
        y: float,
        z: float = 0,
        text_type: str = None,
        document_id: str = None,
    ) -> dict:
        """Create a text note annotation in a view.

        All coordinates are in Revit internal units (feet).

        Args:
            view_id: The view ID to place the text note in.
            text: The text content to display.
            x: X coordinate in feet.
            y: Y coordinate in feet.
            z: Z coordinate in feet (default 0).
            text_type: Optional text note type name. Uses project default if not provided.
            document_id: Optional document ID. Uses active document if not provided.

        Returns the created text note with its ID, text, and location.
        The operation is wrapped in a Revit transaction.
        """
        return add_text_note(
            view_id=view_id,
            text=text,
            x=x,
            y=y,
            z=z,
            text_type=text_type,
            document_id=document_id,
        )

    @mcp.tool()
    def revit_create_tag(
        view_id: str,
        element_id: str,
        x: float,
        y: float,
        z: float = 0,
        tag_type: str = None,
        has_leader: bool = False,
        document_id: str = None,
    ) -> dict:
        """Create a tag annotation for an MEP element.

        Tags display parameter values from the tagged element (e.g., duct size,
        pipe diameter, equipment name).

        All coordinates are in Revit internal units (feet).

        Args:
            view_id: The view ID to place the tag in.
            element_id: The element ID to tag (duct, pipe, equipment, etc.).
            x: Tag head X coordinate in feet.
            y: Tag head Y coordinate in feet.
            z: Tag head Z coordinate in feet (default 0).
            tag_type: Optional tag family type name. Uses project default if not provided.
            has_leader: Whether to show a leader line (default False).
            document_id: Optional document ID. Uses active document if not provided.

        Returns the created tag with its ID, tagged element ID, and location.
        The operation is wrapped in a Revit transaction.
        """
        return add_tag(
            view_id=view_id,
            element_id=element_id,
            x=x,
            y=y,
            z=z,
            tag_type=tag_type,
            has_leader=has_leader,
            document_id=document_id,
        )

    @mcp.tool()
    def revit_create_dimension(
        view_id: str,
        references: list[dict],
        dimension_type: str = None,
        document_id: str = None,
        line_start: dict = None,
        line_end: dict = None,
    ) -> dict:
        """Create a dimension annotation between elements.

        Args:
            view_id: The view ID to place the dimension in.
            references: List of element references to dimension. Each reference
                needs an exact "stable_reference" geometry string. At least 2 references required.
            dimension_type: Optional dimension type name. Uses project default if not provided.
            document_id: Optional document ID. Uses active document if not provided.

            line_start / line_end: Exact {"x","y","z"} endpoints in Revit internal feet.

        Returns the created dimension with its ID, value, and value string.
        The operation is wrapped in a Revit transaction.
        """
        return add_dimension(
            view_id=view_id,
            references=references,
            dimension_type=dimension_type,
            document_id=document_id,
            line_start=line_start,
            line_end=line_end,
        )

    @mcp.tool()
    def revit_create_spot_elevation(
        view_id: str,
        element_id: str,
        point_x: float,
        point_y: float,
        point_z: float,
        bend_x: float,
        bend_y: float,
        bend_z: float,
        end_x: float,
        end_y: float,
        end_z: float,
        spot_type: str = None,
        document_id: str = None,
        stable_reference: str = None,
    ) -> dict:
        """Create a spot elevation annotation on an element.

        Spot elevations display the elevation at a specific point on an element.

        All coordinates are in Revit internal units (feet).

        Args:
            view_id: The view ID to place the spot elevation in.
            element_id: The element ID to annotate (floor, slab, etc.).
            point_x: Point X coordinate in feet (where elevation is measured).
            point_y: Point Y coordinate in feet.
            point_z: Point Z coordinate in feet.
            bend_x: Bend point X coordinate in feet.
            bend_y: Bend point Y coordinate in feet.
            bend_z: Bend point Z coordinate in feet.
            end_x: End point X coordinate in feet (text location).
            end_y: End point Y coordinate in feet.
            end_z: End point Z coordinate in feet.
            spot_type: Optional spot dimension type name. Uses project default if not provided.
            document_id: Optional document ID. Uses active document if not provided.

            stable_reference: Required exact Revit geometry reference; element_id alone is insufficient.

        Returns the created spot elevation with its ID, value, and value string.
        The operation is wrapped in a Revit transaction.
        """
        return add_spot_elevation(
            view_id=view_id,
            element_id=element_id,
            point_x=point_x,
            point_y=point_y,
            point_z=point_z,
            bend_x=bend_x,
            bend_y=bend_y,
            bend_z=bend_z,
            end_x=end_x,
            end_y=end_y,
            end_z=end_z,
            spot_type=spot_type,
            document_id=document_id,
            stable_reference=stable_reference,
        )

    @mcp.tool()
    def revit_create_detail_line(
        view_id: str,
        start_x: float,
        start_y: float,
        start_z: float,
        end_x: float,
        end_y: float,
        end_z: float,
        line_style: str = None,
        document_id: str = None,
    ) -> dict:
        """Create a detail line annotation in a view.

        Detail lines are view-specific and do not affect the model geometry.

        All coordinates are in Revit internal units (feet).

        Args:
            view_id: The view ID to place the detail line in.
            start_x: Start point X coordinate in feet.
            start_y: Start point Y coordinate in feet.
            start_z: Start point Z coordinate in feet.
            end_x: End point X coordinate in feet.
            end_y: End point Y coordinate in feet.
            end_z: End point Z coordinate in feet.
            line_style: Optional line style name (e.g., "Wide Lines", "Medium Lines").
                Uses project default if not provided.
            document_id: Optional document ID. Uses active document if not provided.

        Returns the created detail line with its ID and geometry.
        The operation is wrapped in a Revit transaction.
        """
        return add_detail_line(
            view_id=view_id,
            start_x=start_x,
            start_y=start_y,
            start_z=start_z,
            end_x=end_x,
            end_y=end_y,
            end_z=end_z,
            line_style=line_style,
            document_id=document_id,
        )
