"""Fail-closed Dynamo graph preflight for a future native MANUAL/no-RUN loader.

This module NEVER opens Dynamo, starts a runner or executes a graph.
Only managed files under the Dynamo staging or owned Job/Temp/Dynamo bundles are admissible.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

MAX_GRAPH_BYTES = 2 * 1024 * 1024
MAX_NODES = 1000
MAX_CONNECTORS = 4000
BANNED_MARKERS = (
    "scriptevaluator",
    "process.start", "system.io", "file.write", "webrequest",
)


class DynamoPreflightError(ValueError):
    pass


def validate_staged_dyn(path: str, root: str | None = None) -> dict:
    if not isinstance(path, str) or not path.strip():
        raise DynamoPreflightError("Explicit local .dyn path required")
    appdata = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "RevitGPT"
    if root is not None:
        accepted_roots = [Path(root)]
    else:
        accepted_roots = [
            appdata / "dynamo" / "staging",  # retain old P2 usage
            appdata / "libraries" / "dynamo",
            appdata / "libraries" / "jobs",
            appdata / "temp-jobs",
        ]
    source = Path(path)
    if not source.is_absolute() or source.suffix.lower() != ".dyn":
        raise DynamoPreflightError("Only absolute .dyn paths are accepted")
    # Refuse symlink/junction traversal for the graph and all its ancestors.
    for component in (source, *source.parents):
        if component.is_symlink() or getattr(component, "is_junction", lambda: False)():
            raise DynamoPreflightError("Symlink/junction traversal is not allowed")
    source = source.resolve(strict=True)
    managed_roots = [p.resolve(strict=True) for p in accepted_roots if p.is_dir()]
    staging_root = (appdata / "dynamo" / "staging").resolve(strict=False)
    if not any(source.is_relative_to(managed) and source != managed for managed in managed_roots) or not source.is_file():
        raise DynamoPreflightError("File outside managed Dynamo/Job/Temp owner roots")
    if source.stat().st_size > MAX_GRAPH_BYTES or source.stat().st_size == 0:
        raise DynamoPreflightError("Graph size exceeds accepted bounds")
    raw = source.read_bytes()
    if len(raw) > MAX_GRAPH_BYTES:
        raise DynamoPreflightError("Oversize graph")
    try:
        graph = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise DynamoPreflightError("Invalid .dyn JSON") from exc
    if not isinstance(graph, dict) or not isinstance(graph.get("Nodes"), list) or not isinstance(graph.get("Connectors"), list):
        raise DynamoPreflightError("Graph must contain Nodes and Connectors arrays")
    nodes, connectors = graph["Nodes"], graph["Connectors"]
    if len(nodes) > MAX_NODES or len(connectors) > MAX_CONNECTORS:
        raise DynamoPreflightError("Graph exceeds node/connector limits")
    for node in nodes:
        if not isinstance(node, dict):
            raise DynamoPreflightError("Invalid node")
        identity = " ".join(str(node.get(key, "")) for key in (
            "NodeType", "ConcreteType", "Name", "FunctionSignature", "Code"
        )).lower()
        if any(marker in identity for marker in BANNED_MARKERS):
            raise DynamoPreflightError("Executable or unsafe node type requires manual review")
        if ("pythonscript" in identity or "pythonnode" in identity) and source.is_relative_to(staging_root):
            raise DynamoPreflightError("Python Node requires explicitly owned Job/Temp/Dynamo bundle")
        if not node.get("Id"):
            raise DynamoPreflightError("Every node requires an ID")
        if "zerotouch" in identity and (
            not str(node.get("ConcreteType", "")).strip().endswith(", DynamoCore")
            or not isinstance(node.get("FunctionSignature"), str)
            or not node["FunctionSignature"].strip()
        ):
            raise DynamoPreflightError("Unreviewed ZeroTouch function")

    # This is validation ONLY. A future host adapter must separately enforce
    # no-evaluation MANUAL launch, inspect dependencies and prove zero effects.
    return {
        "status": "PREFLIGHT_ONLY_NOT_LOADED",
        "safe_to_execute": False,
        "manual_no_run_host_verified": False,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "node_count": len(nodes),
        "connector_count": len(connectors),
        "path": str(source),
    }


def stage_dynamo_graph(source_path: str) -> dict:
    """Stage a validated workspace graph into private Dynamo staging atomically.

    No graph execution. Reject symlinks and arbitrary source folders.
    """
    import uuid
    if not isinstance(source_path, str) or not source_path:
        raise DynamoPreflightError("Explicit workspace graph required")
    appdata = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "RevitGPT"
    workspace = (appdata / "workspace" / "dynamo-draft").resolve(strict=True)
    source = Path(source_path)
    if not source.is_absolute() or source.suffix.lower() != ".dyn":
        raise DynamoPreflightError("Absolute .dyn source required")
    if source.is_symlink() or getattr(source, "is_junction", lambda: False)():
        raise DynamoPreflightError("Linked graph source is forbidden")
    source = source.resolve(strict=True)
    if source.parent != workspace or not source.is_file():
        raise DynamoPreflightError("Graph must be in managed workspace/dynamo-draft")
    raw = source.read_bytes()
    if not raw or len(raw) > MAX_GRAPH_BYTES:
        raise DynamoPreflightError("Graph size invalid")
    try:
        graph = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise DynamoPreflightError("Invalid graph JSON") from exc
    if not isinstance(graph, dict) or not isinstance(graph.get("Nodes"), list) or not isinstance(graph.get("Connectors"), list):
        raise DynamoPreflightError("Missing graph structure")
    # Stage only an immutable content-addressed file, never overwrite existing bytes.
    digest = hashlib.sha256(raw).hexdigest()
    root = appdata / "dynamo" / "staging"
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve(strict=True)
    if root.is_symlink() or getattr(root, "is_junction", lambda: False)():
        raise DynamoPreflightError("Linked staging directory is forbidden")
    destination = root / (digest + ".dyn")
    if destination.exists():
        if destination.is_symlink() or destination.read_bytes() != raw:
            raise DynamoPreflightError("Staging hash collision or modified file")
    else:
        temporary = root / (".stage-" + uuid.uuid4().hex + ".tmp")
        try:
            with temporary.open("xb") as stream:
                stream.write(raw)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    result = validate_staged_dyn(str(destination), str(root))
    return {**result, "status": "STAGED_NOT_RUN"}
