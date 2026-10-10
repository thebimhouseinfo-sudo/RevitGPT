"""HTTP client for the local Revit add-in/pyRevit bridge."""

from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import BRIDGE_TIMEOUT_SECONDS, BRIDGE_URL
from utils.logger import log_runtime

WRITE_TIMEOUT = float(BRIDGE_TIMEOUT_SECONDS * 10)


class RevitBridgeError(RuntimeError):
    """Raised when the Revit bridge returns an error response."""


class RevitBridgeUnavailableError(RuntimeError):
    """Raised when the Revit bridge cannot be reached."""


def _make_request_id() -> str:
    return str(uuid.uuid4())


def _send_request(
    endpoint: str,
    payload: dict | None = None,
    method: str = "GET",
    timeout: float | None = None,
) -> dict:
    url = f"{BRIDGE_URL}/{endpoint.lstrip('/')}"
    request_id = _make_request_id()

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Request-ID": request_id,
    }

    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = Request(url, data=data, headers=headers, method=method)
    effective_timeout = timeout or BRIDGE_TIMEOUT_SECONDS

    log_runtime("bridge_request", endpoint=endpoint, method=method, request_id=request_id)
    try:
        with urlopen(request, timeout=effective_timeout) as response:
            response_body = response.read().decode("utf-8")
            result = json.loads(response_body)
        log_runtime("bridge_response", endpoint=endpoint, method=method, request_id=request_id, ok=True)
    except HTTPError as exc:
        log_runtime("bridge_response", endpoint=endpoint, method=method, request_id=request_id, ok=False, error=repr(exc))
        # An HTTP response means the bridge (or gateway) replied.
        # Native router API errors can be 5xx (e.g. 501 for disabled writes,
        # 504 for an ambiguous write timeout); they are not connection loss.
        try:
            error_result = json.loads(exc.read().decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            error_result = None
        if isinstance(error_result, dict):
            error_info = error_result.get("error")
            if isinstance(error_info, dict) and isinstance(error_info.get("message"), str):
                raise RevitBridgeError(
                    f"Bridge HTTP {exc.code}: {error_info['message']}"
                ) from exc
        if exc.code == 504:
            # A write may have committed despite a gateway timeout.
            # Fail closed even when the response body is missing/malformed.
            raise RevitBridgeError(
                "Bridge HTTP 504: request timed out; outcome unknown; "
                "do not retry automatically."
            ) from exc
        if 400 <= exc.code < 500:
            raise RevitBridgeError(f"Bridge returned HTTP {exc.code}") from exc
        raise RevitBridgeUnavailableError(
            f"Cannot reach Revit bridge at {url}: {exc}"
        ) from exc
    except (URLError, TimeoutError, OSError) as exc:
        log_runtime("bridge_response", endpoint=endpoint, method=method, request_id=request_id, ok=False, error=repr(exc))
        raise RevitBridgeUnavailableError(
            f"Cannot reach Revit bridge at {url}: {exc}"
        ) from exc
    except ValueError as exc:
        log_runtime("bridge_response", endpoint=endpoint, method=method, request_id=request_id, ok=False, error=repr(exc))
        raise RevitBridgeError(f"Invalid JSON response from bridge: {exc}") from exc

    if not isinstance(result, dict):
        raise RevitBridgeError("Bridge response must be a JSON object.")

    if "error" in result:
        error_info = result["error"]
        raise RevitBridgeError(
            f"Bridge error: {error_info.get('message', 'Unknown error')}"
        )

    return result


def health_check() -> dict:
    try:
        result = _send_request("/health")
        return {
            "available": True,
            "bridge_url": BRIDGE_URL,
            "bridge": result.get("data", result),
        }
    except (RevitBridgeUnavailableError, RevitBridgeError) as exc:
        return {
            "available": False,
            "bridge_url": BRIDGE_URL,
            "error": str(exc),
        }


def get_binding_status() -> dict:
    """Read native binding. This does not confer a remote MCP session lease."""
    result = _send_request("/binding/status")
    return result.get("data", {})


def get_active_document() -> dict:
    result = _send_request("/document/active")
    return result.get("data", result)


def get_documents() -> list[dict]:
    result = _send_request("/documents")
    return result.get("data", [])


def get_views(document_id: str | None = None) -> list[dict]:
    payload = {"document_id": document_id} if document_id else None
    result = _send_request("/views", payload=payload, method="POST" if payload else "GET")
    return result.get("data", [])


def get_levels(document_id: str | None = None) -> list[dict]:
    payload = {"document_id": document_id} if document_id else None
    result = _send_request("/levels", payload=payload, method="POST" if payload else "GET")
    return result.get("data", [])


def get_elements(
    document_id: str | None = None,
    category: str | None = None,
    class_name: str | None = None,
    family: str | None = None,
    type_name: str | None = None,
    view_id: str | None = None,
    parameters: list[str] | None = None,
) -> list[dict]:
    payload: dict[str, Any] = {}
    if document_id:
        payload["document_id"] = document_id
    if category:
        payload["category"] = category
    if class_name:
        payload["class"] = class_name
    if family:
        payload["family"] = family
    if type_name:
        payload["type"] = type_name
    if view_id:
        payload["view_id"] = view_id
    if parameters is not None:
        payload["parameters"] = _validated_parameter_names(parameters)

    result = _send_request("/elements", payload=payload, method="POST")
    return result.get("data", [])


def _validated_parameter_names(names: list[str]) -> list[str]:
    """Fail before transport on oversized or ambiguous exact-name requests."""
    if not isinstance(names, list) or len(names) > 16:
        raise ValueError("parameters must be a list of at most 16 names")
    found: set[str] = set()
    for name in names:
        if not isinstance(name, str) or not name or len(name) > 128 or name != name.strip():
            raise ValueError("invalid parameter name")
        folded = name.casefold()
        if folded in found:
            raise ValueError("duplicate parameter name")
        found.add(folded)
    return names


def aggregate_elements(
    document_id: str | None = None,
    category: str | None = None,
    class_name: str | None = None,
    family: str | None = None,
    type_name: str | None = None,
    view_id: str | None = None,
    group_by: str | None = None,
) -> dict:
    if group_by is not None and group_by not in ("category", "family", "type", "level"):
        raise ValueError("group_by must be category, family, type, or level")
    payload = {}
    for key, value in (
        ("document_id", document_id), ("category", category), ("class", class_name),
        ("family", family), ("type", type_name), ("view_id", view_id),
        ("group_by", group_by),
    ):
        if value is not None:
            payload[key] = value
    result = _send_request("/elements/aggregate", payload=payload, method="POST")
    return result.get("data", result)


def get_selection(document_id: str | None = None) -> dict:
    payload = {"document_id": document_id} if document_id else {}
    return _send_request("/ui/selection", payload=payload, method="POST")["data"]


def _valid_ui_ids(element_ids: list[str], allow_empty: bool = True) -> list[str]:
    if not isinstance(element_ids, list) or len(element_ids) > 500 or (not allow_empty and not element_ids):
        raise ValueError("element_ids must be a bounded list")
    if any(not isinstance(i, str) or not i.isdecimal() or int(i) < 1 for i in element_ids) or len(set(element_ids)) != len(element_ids):
        raise ValueError("element_ids contain invalid or duplicate IDs")
    return element_ids


def set_selection(element_ids: list[str], document_id: str | None = None,
                  mode: str = "replace") -> dict:
    if mode not in ("replace", "add", "remove", "clear"):
        raise ValueError("Unsupported selection mode")
    if mode == "clear" and element_ids:
        raise ValueError("clear requires empty element_ids")
    payload = {"element_ids": _valid_ui_ids(element_ids)}
    if mode != "replace":
        payload["mode"] = mode
    if document_id: payload["document_id"] = document_id
    return _send_request("/ui/selection/set", payload=payload, method="POST")["data"]


def show_elements(element_ids: list[str], document_id: str | None = None) -> dict:
    payload = {"element_ids": _valid_ui_ids(element_ids, allow_empty=False)}
    if document_id: payload["document_id"] = document_id
    return _send_request("/ui/show", payload=payload, method="POST")["data"]


def select_related(element_id: str, relation: str, apply: bool = False,
                   document_id: str | None = None) -> dict:
    if not isinstance(element_id, str) or not element_id.isdecimal() or int(element_id) < 1:
        raise ValueError("element_id must be positive ElementId")
    if relation not in ("host", "hosted", "connected"):
        raise ValueError("relation must be host, hosted or connected")
    if not isinstance(apply, bool):
        raise ValueError("apply must be boolean")
    payload = {"element_id": element_id, "relation": relation, "apply": apply}
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/ui/select-related", payload=payload, method="POST")["data"]


def temporary_visibility(mode: str, element_ids: list[str] | None = None,
                         document_id: str | None = None) -> dict:
    if mode not in ("hide", "isolate", "reset"):
        raise ValueError("mode must be hide, isolate or reset")
    ids = _valid_ui_ids(element_ids if element_ids is not None else [],
                        allow_empty=mode == "reset")
    if (mode == "reset" and ids) or (mode != "reset" and not ids):
        raise ValueError("inconsistent temporary visibility target set")
    payload = {"mode": mode, "element_ids": ids}
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/ui/visibility/temporary", payload=payload, method="POST")["data"]


def activate_view(view_id: str, document_id: str | None = None) -> dict:
    if not isinstance(view_id, str) or not view_id.isdecimal() or int(view_id) < 1:
        raise ValueError("view_id must be a positive Revit ElementId string")
    payload = {"view_id": view_id}
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/ui/view/activate", payload=payload, method="POST")["data"]


def get_element(
    element_id: str,
    document_id: str | None = None,
    include_connectors: bool = False,
    parameters: list[str] | None = None,
) -> dict:
    payload: dict[str, Any] = {"element_id": element_id}
    if document_id:
        payload["document_id"] = document_id
    if include_connectors:
        payload["include_connectors"] = True
    if parameters is not None:
        payload["parameters"] = _validated_parameter_names(parameters)
    result = _send_request("/element", payload=payload, method="POST")
    return result.get("data", result)


def get_view_properties(view_id: str, document_id: str | None = None) -> dict:
    if not isinstance(view_id, str) or not view_id.isdecimal() or int(view_id) < 1:
        raise ValueError("view_id must be a positive ElementId string")
    payload = {"view_id": view_id}
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/view/properties", payload=payload, method="POST")["data"]


def get_spatial_warnings(document_id: str | None = None,
                         include_warnings: bool = True) -> dict:
    if not isinstance(include_warnings, bool):
        raise ValueError("include_warnings must be bool")
    payload = {"include_warnings": include_warnings}
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/model/spatial-warnings", payload=payload, method="POST")["data"]


def get_mep_quantities(mode: str = "all", category: str | None = None,
                       document_id: str | None = None) -> dict:
    if mode not in ("all", "equipment"):
        raise ValueError("mode must be all or equipment")
    payload = {"mode": mode}
    if category is not None:
        if not isinstance(category, str) or not category.strip() or len(category) > 128:
            raise ValueError("category filter invalid")
        payload["category"] = category
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/mep/quantities", payload=payload, method="POST")["data"]


def get_mep_systems(kind: str | None = None, document_id: str | None = None) -> list[dict]:
    if kind is not None and kind not in ("duct", "pipe"):
        raise ValueError("kind must be duct or pipe")
    payload = {}
    if kind is not None:
        payload["kind"] = kind
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/mep/systems", payload=payload, method="POST")["data"]


def get_categories(document_id: str | None = None,
                   name_contains: str | None = None) -> list[dict]:
    if name_contains is not None and (
        not isinstance(name_contains, str) or not name_contains.strip() or len(name_contains) > 128
    ):
        raise ValueError("name_contains must be a nonempty bounded string")
    payload = {}
    if document_id: payload["document_id"] = document_id
    if name_contains is not None: payload["name_contains"] = name_contains
    return _send_request("/categories", payload=payload, method="POST")["data"]


def inspect_element(element_id: str, aspect: str,
                    document_id: str | None = None) -> dict:
    if not isinstance(element_id, str) or not element_id.isdecimal() or int(element_id) < 1:
        raise ValueError("element_id must be positive ElementId string")
    if aspect not in ("geometry", "relationships", "family"):
        raise ValueError("aspect must be geometry, relationships or family")
    payload = {"element_id": element_id, "aspect": aspect}
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/element/inspect", payload=payload, method="POST")["data"]


def get_element_parameters(element_id: str, document_id: str | None = None,
                           include_type: bool = True) -> dict:
    if not isinstance(element_id, str) or not element_id.isdecimal() or int(element_id) < 1:
        raise ValueError("element_id must be a positive ElementId string")
    if not isinstance(include_type, bool):
        raise ValueError("include_type must be bool")
    payload = {"element_id": element_id, "include_type": include_type}
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/element/parameters", payload=payload, method="POST")["data"]


def get_element_connectors(element_id: str, document_id: str | None = None) -> list[dict]:
    payload: dict[str, Any] = {"element_id": element_id}
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/element/connectors", payload=payload, method="POST")
    return result.get("data", [])


def get_families(
    document_id: str | None = None,
    category: str | None = None,
) -> list[dict]:
    payload: dict[str, Any] = {}
    if document_id:
        payload["document_id"] = document_id
    if category:
        payload["category"] = category
    result = _send_request("/families", payload=payload, method="POST")
    return result.get("data", [])


def get_family_types(
    family: str | None = None,
    category: str | None = None,
    document_id: str | None = None,
) -> list[dict]:
    payload: dict[str, Any] = {}
    if family:
        payload["family"] = family
    if category:
        payload["category"] = category
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/family/types", payload=payload, method="POST")
    return result.get("data", [])


def get_system_types(
    classification: str | None = None,
    document_id: str | None = None,
) -> list[dict]:
    payload: dict[str, Any] = {}
    if classification:
        payload["classification"] = classification
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/system/types", payload=payload, method="POST")
    return result.get("data", [])


def place_family_instance(
    family: str,
    type: str,
    x: float,
    y: float,
    z: float = 0,
    level_id: str | None = None,
    rotation: float = 0,
    document_id: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "family": family,
        "type": type,
        "x": x,
        "y": y,
        "z": z,
        "rotation": rotation,
    }
    if level_id:
        payload["level_id"] = level_id
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/place", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def create_duct(
    start_x: float,
    start_y: float,
    start_z: float,
    end_x: float,
    end_y: float,
    end_z: float,
    width: float = 0.3,
    height: float = 0.15,
    duct_type: str | None = None,
    system_type: str | None = None,
    level_id: str | None = None,
    document_id: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "start_x": start_x,
        "start_y": start_y,
        "start_z": start_z,
        "end_x": end_x,
        "end_y": end_y,
        "end_z": end_z,
        "width": width,
        "height": height,
    }
    if duct_type:
        payload["duct_type"] = duct_type
    if system_type:
        payload["system_type"] = system_type
    if level_id:
        payload["level_id"] = level_id
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/create/duct", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def create_pipe(
    start_x: float,
    start_y: float,
    start_z: float,
    end_x: float,
    end_y: float,
    end_z: float,
    diameter: float = 0.05,
    pipe_type: str | None = None,
    system_type: str | None = None,
    level_id: str | None = None,
    document_id: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "start_x": start_x,
        "start_y": start_y,
        "start_z": start_z,
        "end_x": end_x,
        "end_y": end_y,
        "end_z": end_z,
        "diameter": diameter,
    }
    if pipe_type:
        payload["pipe_type"] = pipe_type
    if system_type:
        payload["system_type"] = system_type
    if level_id:
        payload["level_id"] = level_id
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/create/pipe", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def set_parameter(
    element_id: str,
    parameter: str,
    value: Any,
    document_id: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "element_id": element_id,
        "parameter": parameter,
        "value": value,
    }
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/parameter/set", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def delete_elements(
    element_ids: list[str],
    document_id: str | None = None,
    confirm: bool = False,
    acknowledged_affected_ids: list[str] | None = None,
) -> dict:
    if not isinstance(element_ids, list) or not 1 <= len(element_ids) <= 50:
        raise ValueError("delete requires 1..50 element IDs")
    if any(not isinstance(x, str) or not x.isdecimal() or int(x) <= 0 for x in element_ids):
        raise ValueError("invalid delete element ID")
    if len(set(element_ids)) != len(element_ids):
        raise ValueError("duplicate delete ID")
    if confirm and (not isinstance(acknowledged_affected_ids, list) or
                    not 1 <= len(acknowledged_affected_ids) <= 2000):
        raise ValueError("delete commit requires acknowledged_affected_ids")
    payload: dict[str, Any] = {"element_ids": element_ids}
    if confirm:
        if any(not isinstance(x, str) or not x.isdecimal() or int(x) <= 0
               for x in acknowledged_affected_ids):
            raise ValueError("invalid acknowledged affected ID")
        if len(set(acknowledged_affected_ids)) != len(acknowledged_affected_ids):
            raise ValueError("duplicate acknowledged affected ID")
        payload["confirm"] = True
        payload["acknowledged_affected_ids"] = acknowledged_affected_ids
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/delete", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def create_architecture(action: str, properties: dict,
                        document_id: str | None = None) -> dict:
    if action not in ("wall", "level", "grid", "model_line"):
        raise ValueError("action must be wall, level, grid or model_line")
    if not isinstance(properties, dict) or not 1 <= len(properties) <= 24:
        raise ValueError("bounded architectural properties required")
    allowed = {
        "wall": {"level_id", "type_id", "height", "start_x", "start_y", "start_z", "end_x", "end_y", "end_z"},
        "level": {"name", "elevation"},
        "grid": {"start_x", "start_y", "start_z", "end_x", "end_y", "end_z"},
        "model_line": {"start_x", "start_y", "start_z", "end_x", "end_y", "end_z", "normal_x", "normal_y", "normal_z"}
    }
    if any(key not in allowed[action] for key in properties):
        raise ValueError("unknown architectural property")
    payload = {"action": action, **properties}
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/architecture/create", payload=payload, method="POST",
                         timeout=WRITE_TIMEOUT)["data"]


def transform_elements(action: str, element_ids: list[str], *,
                       dx: float = 0, dy: float = 0, dz: float = 0,
                       axis_start: dict | None = None, axis_end: dict | None = None,
                       angle: float | None = None, new_type_id: str | None = None,
                       document_id: str | None = None) -> dict:
    if action not in ("copy", "rotate", "change_type"):
        raise ValueError("Invalid transform action")
    if not isinstance(element_ids, list) or not 1 <= len(element_ids) <= 50 or any(
        not isinstance(i, str) or not i.isdecimal() or int(i) < 1 for i in element_ids
    ) or len(set(element_ids)) != len(element_ids):
        raise ValueError("Transform requires 1..50 distinct positive IDs")
    payload = {"action": action, "element_ids": element_ids}
    if action == "copy":
        payload.update({"dx": dx, "dy": dy, "dz": dz})
    elif action == "rotate":
        for prefix, obj in (("axis_start_", axis_start), ("axis_end_", axis_end)):
            if not isinstance(obj, dict) or any(
                k not in obj or type(obj[k]) not in (float, int) for k in ("x", "y", "z")
            ):
                raise ValueError("Axis requires numeric XYZ endpoints")
            payload.update({prefix + k: obj[k] for k in ("x", "y", "z")})
        if type(angle) not in (float, int):
            raise ValueError("Numeric rotation angle required")
        payload["angle"] = angle
    else:
        if not isinstance(new_type_id, str) or not new_type_id.isdecimal() or int(new_type_id) < 1:
            raise ValueError("Valid new_type_id required")
        payload["new_type_id"] = new_type_id
    if document_id:
        payload["document_id"] = document_id
    return _send_request("/transform", payload=payload, method="POST", timeout=WRITE_TIMEOUT)["data"]


def move_element(
    element_id: str,
    dx: float = 0,
    dy: float = 0,
    dz: float = 0,
    x: float | None = None,
    y: float | None = None,
    z: float | None = None,
    document_id: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "element_id": element_id,
        "dx": dx,
        "dy": dy,
        "dz": dz,
    }
    if x is not None:
        payload["x"] = x
    if y is not None:
        payload["y"] = y
    if z is not None:
        payload["z"] = z
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/move", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def get_annotations(
    view_id: str,
    annotation_type: str | None = None,
    document_id: str | None = None,
) -> list[dict]:
    payload: dict[str, Any] = {"view_id": view_id}
    if annotation_type:
        payload["type"] = annotation_type
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/annotations", payload=payload, method="POST")
    return result.get("data", [])


def create_text_note(
    view_id: str,
    text: str,
    x: float,
    y: float,
    z: float = 0,
    text_type: str | None = None,
    document_id: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "view_id": view_id,
        "text": text,
        "x": x,
        "y": y,
        "z": z,
    }
    if text_type:
        payload["text_type"] = text_type
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/annotation/text", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def create_tag(
    view_id: str,
    element_id: str,
    x: float,
    y: float,
    z: float = 0,
    tag_type: str | None = None,
    has_leader: bool = False,
    document_id: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "view_id": view_id,
        "element_id": element_id,
        "x": x,
        "y": y,
        "z": z,
        "has_leader": has_leader,
    }
    if tag_type:
        payload["tag_type"] = tag_type
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/annotation/tag", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def create_dimension(
    view_id: str,
    references: list[dict],
    dimension_type: str | None = None,
    document_id: str | None = None,
    line_start: dict | None = None,
    line_end: dict | None = None,
) -> dict:
    if not isinstance(references, list) or not 2 <= len(references) <= 16 or any(
        not isinstance(r, dict) or not isinstance(r.get("stable_reference"), str)
        or not r["stable_reference"] for r in references
    ):
        raise ValueError("dimension requires 2..16 exact stable geometry references")
    if not isinstance(line_start, dict) or not isinstance(line_end, dict) or any(
        key not in obj or type(obj[key]) not in (int, float)
        for obj in (line_start, line_end) for key in ("x", "y", "z")
    ):
        raise ValueError("dimension requires exact start/end XYZ")
    payload: dict[str, Any] = {
        "view_id": view_id,
        "references": references,
        **{"line_start_" + k: line_start[k] for k in ("x", "y", "z")},
        **{"line_end_" + k: line_end[k] for k in ("x", "y", "z")},
    }
    if dimension_type:
        payload["dimension_type"] = dimension_type
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/annotation/dimension", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def create_spot_elevation(
    view_id: str,
    element_id: str,
    point_x: float,
    point_y: float,
    point_z: float,
    bend_x: float,
    bend_y: float,
    bend_z: float,
    end_x: float,
    end_y: float,
    end_z: float,
    spot_type: str | None = None,
    document_id: str | None = None,
    stable_reference: str | None = None,
) -> dict:
    if not isinstance(stable_reference, str) or not stable_reference.strip():
        raise ValueError("spot elevation requires a stable geometry reference")
    payload: dict[str, Any] = {
        "stable_reference": stable_reference,
        "view_id": view_id,
        "element_id": element_id,
        "point_x": point_x,
        "point_y": point_y,
        "point_z": point_z,
        "bend_x": bend_x,
        "bend_y": bend_y,
        "bend_z": bend_z,
        "end_x": end_x,
        "end_y": end_y,
        "end_z": end_z,
    }
    if spot_type:
        payload["spot_type"] = spot_type
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/annotation/spot_elevation", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)


def create_detail_line(
    view_id: str,
    start_x: float,
    start_y: float,
    start_z: float,
    end_x: float,
    end_y: float,
    end_z: float,
    line_style: str | None = None,
    document_id: str | None = None,
) -> dict:
    payload: dict[str, Any] = {
        "view_id": view_id,
        "start_x": start_x,
        "start_y": start_y,
        "start_z": start_z,
        "end_x": end_x,
        "end_y": end_y,
        "end_z": end_z,
    }
    if line_style:
        payload["line_style"] = line_style
    if document_id:
        payload["document_id"] = document_id
    result = _send_request("/annotation/detail_line", payload=payload, method="POST", timeout=WRITE_TIMEOUT)
    return result.get("data", result)
