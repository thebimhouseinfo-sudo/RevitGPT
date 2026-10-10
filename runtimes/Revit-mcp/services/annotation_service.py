"""Annotation operations via the Revit bridge."""

from connection.bridge import (
    create_detail_line,
    create_dimension,
    create_spot_elevation,
    create_tag,
    create_text_note,
    get_annotations,
)


def list_annotations(
    view_id: str,
    annotation_type: str | None = None,
    document_id: str | None = None,
) -> list[dict]:
    return get_annotations(view_id=view_id, annotation_type=annotation_type, document_id=document_id)


def add_text_note(
    view_id: str,
    text: str,
    x: float,
    y: float,
    z: float = 0,
    text_type: str | None = None,
    document_id: str | None = None,
) -> dict:
    return create_text_note(
        view_id=view_id,
        text=text,
        x=x,
        y=y,
        z=z,
        text_type=text_type,
        document_id=document_id,
    )


def add_tag(
    view_id: str,
    element_id: str,
    x: float,
    y: float,
    z: float = 0,
    tag_type: str | None = None,
    has_leader: bool = False,
    document_id: str | None = None,
) -> dict:
    return create_tag(
        view_id=view_id,
        element_id=element_id,
        x=x,
        y=y,
        z=z,
        tag_type=tag_type,
        has_leader=has_leader,
        document_id=document_id,
    )


def add_dimension(
    view_id: str,
    references: list[dict],
    dimension_type: str | None = None,
    document_id: str | None = None,
    line_start: dict | None = None,
    line_end: dict | None = None,
) -> dict:
    return create_dimension(
        view_id=view_id,
        references=references,
        dimension_type=dimension_type,
        document_id=document_id,
        line_start=line_start,
        line_end=line_end,
    )


def add_spot_elevation(
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
    spot_type: str | None = None,
    document_id: str | None = None,
    stable_reference: str | None = None,
) -> dict:
    return create_spot_elevation(
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


def add_detail_line(
    view_id: str,
    start_x: float,
    start_y: float,
    start_z: float,
    end_x: float,
    end_y: float,
    end_z: float,
    line_style: str | None = None,
    document_id: str | None = None,
) -> dict:
    return create_detail_line(
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
