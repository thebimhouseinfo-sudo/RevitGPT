"""Fail-closed Dynamo graph preflight for a future native MANUAL/no-RUN loader.

This module NEVER opens Dynamo, starts a runner or executes a graph.
Only managed files under LocalAppData/RevitGPT/dynamo/staging are admissible.
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
    "pythonscript", "pythonnode", "codeblocknode", "scriptevaluator",
    "zerotouch", "process.start", "system.io", "file.write", "webrequest",
)


class DynamoPreflightError(ValueError):
    pass


def validate_staged_dyn(path: str, root: str | None = None) -> dict:
    if not isinstance(path, str) or not path.strip():
        raise DynamoPreflightError("Explicit local .dyn path required")
    managed = Path(root) if root is not None else Path(
        os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local"
    ) / "RevitGPT" / "dynamo" / "staging"
    managed = managed.resolve(strict=True)
    source = Path(path)
    if not source.is_absolute() or source.suffix.lower() != ".dyn":
        raise DynamoPreflightError("Only absolute .dyn paths are accepted")
    # Reject reparse traversal even if it resolves back inside staging.
    for component in (source, *source.parents):
        if component.is_symlink() or getattr(component, "is_junction", lambda: False)():
            raise DynamoPreflightError("Symlink/junction traversal is not allowed")
    source = source.resolve(strict=True)
    if not source.is_relative_to(managed) or not source.is_file():
        raise DynamoPreflightError("File outside the managed staging root")
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
        if not node.get("Id"):
            raise DynamoPreflightError("Every node requires an ID")
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
