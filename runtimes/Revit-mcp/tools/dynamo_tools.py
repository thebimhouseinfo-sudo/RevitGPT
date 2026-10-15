"""Bound Dynamo .dyn loader. Does not execute graphs or install packages."""
from connection.bridge import load_dyn_file, run_dyn_file


def register(mcp) -> None:
    @mcp.tool()
    def revit_load_dyn_file(path: str, document_id: str = None) -> dict:
        """Open a locally staged .dyn graph in Dynamo MANUAL mode, never RUN.

        Requires file preflight on the current bound Revit model.
        Unsupported nodes/packages/host API fail closed.
        Report LOADED_MANUAL_HOST_UNVERIFIED until real no-side-effect HAT proof.
        """
        return load_dyn_file(path, document_id)

    @mcp.tool()
    def revit_run_dyn_file(path: str, document_id: str = None) -> dict:
        """Execute a preflighted, staged .dyn ONCE inside DynamoRevit.

        Requires explicit execution intent and the active bound Revit model.
        A dispatch acknowledgment is NOT proof of graph completion; inspect
        resulting model/data and never blindly retry an uncertain write.
        """
        return run_dyn_file(path, document_id)
