"""Element operations via the Revit bridge."""

from connection.bridge import get_element, get_elements


def list_elements(
    document_id: str | None = None,
    category: str | None = None,
    class_name: str | None = None,
    family: str | None = None,
    type_name: str | None = None,
    view_id: str | None = None,
    parameters: list[str] | None = None,
) -> list[dict]:
    """Get filtered elements from the document."""
    return get_elements(
        document_id=document_id,
        category=category,
        class_name=class_name,
        family=family,
        type_name=type_name,
        view_id=view_id,
        parameters=parameters,
    )


def get_element_by_id(element_id: str, document_id: str | None = None) -> dict:
    """Get a single element by its ID."""
    return get_element(element_id, document_id)
