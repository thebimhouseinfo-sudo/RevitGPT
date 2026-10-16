"""Bound Dynamo graph staging, native autorun and diagnostic load operations."""
from connection.bridge import load_dyn_file, run_dyn_file


def register(mcp) -> None:
    @mcp.tool()
    def revit_stage_dyn_file(path: str, document_id: str = None) -> dict:
        """Stage, auto-load AND auto-run a workspace graph in one operation.

        User execution intent is conveyed by calling this tool. The native
        Dynamo command dispatch is not completion proof; verify model/result.
        Never retry an ambiguous graph write without checking actual effects.
        """
        from services.dynamo_preflight import stage_dynamo_graph
        staged = stage_dynamo_graph(path)
        dispatched = run_dyn_file(staged["path"], document_id)
        return {"stage": staged, "native_dispatch": dispatched,
                "auto_load_and_run_requested": True,
                "execution_verified": False}

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
