"""Revit schedules: bounded rows, field inspection and guarded editing."""
from connection.bridge import list_schedules, get_schedule, update_schedule


def register(mcp) -> None:
    @mcp.tool()
    def revit_list_schedules(document_id: str = None) -> list[dict]:
        """Read all non-template schedule IDs and names (max 2000)."""
        return list_schedules(document_id)

    @mcp.tool()
    def revit_get_schedule(schedule_id: str, document_id: str = None) -> dict:
        """Get field IDs and up to 500 schedule body rows without silent truncation."""
        return get_schedule(schedule_id, document_id)

    @mcp.tool()
    def revit_update_schedule(schedule_id: str, action: str,
                              field_id: str = None,
                              document_id: str = None,
                              value: str = None) -> dict:
        """Hide/show fields, add string equality filters and sort fields, or clear.

        Native write approval and Revit Transaction required. Arbitrary schedule
        cell writing is unsupported.
        """
        return update_schedule(schedule_id, action, field_id, document_id, value)
