"""Live, read-only Revit bridge probe.

This file is intentionally excluded from GitHub Actions PASS because it requires
an attached real Revit + pyRevit host. It must never mutate the user's model.
Mutation evidence belongs to E-PY-7 and must include readback + cleanup.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from connection.bridge import (
    get_active_document,
    get_documents,
    get_levels,
    get_views,
    health_check,
)


def main():
    print("=" * 60)
    print("REVIT MCP - LIVE READ-ONLY CONNECTION PROBE")
    print("=" * 60)

    health = health_check()
    if not health["available"]:
        print("[FAIL] Bridge is unavailable:", health.get("error", "unknown"))
        return False

    bridge = health.get("bridge", {})
    if bridge.get("status") != "ok":
        print("[FAIL] Bridge health payload is not ready:", bridge)
        return False
    print("[PASS] health")

    doc = get_active_document()
    if not isinstance(doc, dict) or not doc.get("title"):
        print("[FAIL] No active Revit document is available:", doc)
        return False
    print("[PASS] active document:", doc.get("title"))

    documents = get_documents()
    if not isinstance(documents, list) or not documents:
        print("[FAIL] Open-document list is empty or invalid:", documents)
        return False
    if not any(item.get("runtime_id") == doc.get("runtime_id") for item in documents):
        print("[FAIL] Active document is missing from /documents result.")
        return False
    print("[PASS] documents:", len(documents))

    views = get_views()
    if not isinstance(views, list):
        print("[FAIL] /views did not return a list.")
        return False
    print("[PASS] views:", len(views))

    levels = get_levels()
    if not isinstance(levels, list):
        print("[FAIL] /levels did not return a list.")
        return False
    print("[PASS] levels:", len(levels))

    print("[PASS] LIVE_READ_ONLY_PROBE")
    print("[INFO] No create/update/delete Revit operation was executed.")
    return True


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
