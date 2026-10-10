"""Bound Dynamo .dyn loader. Does not execute graphs or install packages."""
from connection.bridge import load_dyn_file


def register(mcp) -> None:
    @mcp.tool()
    def revit_load_dyn_file(path: str, document_id: str = None) -> dict:
        """Open a locally staged .dyn graph in Dynamo MANUAL mode, never RUN.

        Requires file preflight and a one-shot native approval on a disposable
        Revit fixture. Unsupported nodes/packages/host API fail closed.
        Report LOADED_MANUAL_HOST_UNVERIFIED until real no-side-effect HAT proof.
        """
        return load_dyn_file(path, document_id)
