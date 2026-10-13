"""Family and type discovery via the Revit bridge."""

from connection.bridge import get_families, get_family_types, get_system_types


def list_families(
    document_id: str | None = None,
    category: str | None = None,
) -> list[dict]:
    return get_families(document_id=document_id, category=category)


def list_family_types(
    family: str | None = None,
    category: str | None = None,
    document_id: str | None = None,
) -> list[dict]:
    return get_family_types(family=family, category=category, document_id=document_id)


def list_system_types(
    classification: str | None = None,
    document_id: str | None = None,
) -> list[dict]:
    return get_system_types(classification=classification, document_id=document_id)
