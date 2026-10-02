"""MEP operations via the Revit bridge."""

from typing import Any

from connection.bridge import (
    create_duct,
    create_pipe,
    delete_elements,
    get_element_connectors,
    move_element,
    place_family_instance,
    set_parameter,
)


def get_connectors(element_id: str, document_id: str | None = None) -> list[dict]:
    return get_element_connectors(element_id, document_id)


def place_instance(
    family: str,
    type: str,
    x: float,
    y: float,
    z: float = 0,
    level_id: str | None = None,
    rotation: float = 0,
    document_id: str | None = None,
) -> dict:
    return place_family_instance(
        family=family,
        type=type,
        x=x,
        y=y,
        z=z,
        level_id=level_id,
        rotation=rotation,
        document_id=document_id,
    )


def create_duct_run(
    start_x: float,
    start_y: float,
    start_z: float,
    end_x: float,
    end_y: float,
    end_z: float,
    width: float = 0.3,
    height: float = 0.15,
    duct_type: str | None = None,
    system_type: str | None = None,
    level_id: str | None = None,
    document_id: str | None = None,
) -> dict:
    return create_duct(
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


def create_pipe_run(
    start_x: float,
    start_y: float,
    start_z: float,
    end_x: float,
    end_y: float,
    end_z: float,
    diameter: float = 0.05,
    pipe_type: str | None = None,
    system_type: str | None = None,
    level_id: str | None = None,
    document_id: str | None = None,
) -> dict:
    return create_pipe(
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


def set_element_parameter(
    element_id: str,
    parameter: str,
    value: Any,
    document_id: str | None = None,
) -> dict:
    return set_parameter(
        element_id=element_id,
        parameter=parameter,
        value=value,
        document_id=document_id,
    )


def delete(
    element_ids: list[str],
    document_id: str | None = None,
) -> dict:
    return delete_elements(element_ids=element_ids, document_id=document_id)


def move(
    element_id: str,
    dx: float = 0,
    dy: float = 0,
    dz: float = 0,
    x: float | None = None,
    y: float | None = None,
    z: float | None = None,
    document_id: str | None = None,
) -> dict:
    return move_element(
        element_id=element_id,
        dx=dx,
        dy=dy,
        dz=dz,
        x=x,
        y=y,
        z=z,
        document_id=document_id,
    )
