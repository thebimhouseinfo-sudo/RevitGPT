"""Live, read-only Revit bridge probe.

This file is intentionally excluded from GitHub Actions PASS because it requires
an attached real Revit + pyRevit host. It must never mutate the user's model.
Mutation evidence belongs to E-PY-7 and must include readback + cleanup.

Safety: the current bridge must not receive Revit-bearing HTTP calls until
E-PY-5B has proven safe UI-thread dispatch. Set
REVITGPT_EPY_SAFE_DISPATCH_CONFIRMED=1 only after that evidence exists.
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


SAFE_DISPATCH_ENV = "REVITGPT_EPY_SAFE_DISPATCH_CONFIRMED"


def safe_dispatch_confirmed() -> bool:
    return os.getenv(SAFE_DISPATCH_ENV) == "1"


def main() -> int:
    print("=" * 60)
    print("REVIT MCP - LIVE READ-ONLY CONNECTION PROBE")
    print("=" * 60)

    if not safe_dispatch_confirmed():
        print(
            "[TEST_BLOCKED] Safe Revit UI-thread dispatch has not been explicitly "
            "confirmed. Refusing to call the bridge."
        )
        print(
            "[INFO] Set {}=1 only after E-PY-5B safety evidence is durable.".format(
                SAFE_DISPATCH_ENV
            )
        )
        return 2

    health = health_check()
    if not health["available"]:
        print("[FAIL] Bridge is unavailable:", health.get("error", "unknown"))
        return 1

    bridge = health.get("bridge", {})
    if bridge.get("status") != "ok":
        print("[FAIL] Bridge health payload is not ready:", bridge)
        return 1
    print("[PASS] health")

    doc = get_active_document()
    if not isinstance(doc, dict) or not doc.get("title"):
        print("[FAIL] No active Revit document is available:", doc)
        return 1
    print("[PASS] active document:", doc.get("title"))

    documents = get_documents()
    if not isinstance(documents, list) or not documents:
        print("[FAIL] Open-document list is empty or invalid:", documents)
        return 1
    if not any(item.get("runtime_id") == doc.get("runtime_id") for item in documents):
        print("[FAIL] Active document is missing from /documents result.")
        return 1
    print("[PASS] documents:", len(documents))

    views = get_views()
    if not isinstance(views, list):
        print("[FAIL] /views did not return a list.")
        return 1
    print("[PASS] views:", len(views))

    levels = get_levels()
    if not isinstance(levels, list):
        print("[FAIL] /levels did not return a list.")
        return 1
    print("[PASS] levels:", len(levels))

    print("[PASS] LIVE_READ_ONLY_PROBE")
    print("[INFO] No create/update/delete Revit operation was executed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
