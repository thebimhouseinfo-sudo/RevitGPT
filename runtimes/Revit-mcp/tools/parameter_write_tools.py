"""Atomic Revit parameter edits; preview-first and Native-gated."""
from connection.bridge import batch_set_parameters, copy_parameters


def register(mcp) -> None:
    @mcp.tool()
    def revit_batch_set_parameters(operations: list[dict],
                                   dry_run: bool = True,
                                   document_id: str = None) -> dict:
        """Atomic bounded SET/SKIP parameter operations with preview by default.

        Specify element_id, parameter exact selector, op, typed value.
        A commit requires the target model to be current and bound.
        """
        return batch_set_parameters(operations, dry_run, document_id)

    @mcp.tool()
    def revit_copy_parameters(source_element_id: str,
                              target_element_ids: list[str],
                              mappings: list[dict], dry_run: bool = True,
                              document_id: str = None) -> dict:
        """Copy 1..16 source parameter mappings to 1..50 targets atomically.

        Exact storage/spec type matching; never silently coerce units.
        """
        return copy_parameters(source_element_id, target_element_ids,
                               mappings, dry_run, document_id)
