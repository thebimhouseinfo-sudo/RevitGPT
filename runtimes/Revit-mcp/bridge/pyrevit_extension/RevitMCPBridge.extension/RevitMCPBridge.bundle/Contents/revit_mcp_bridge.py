"""
Revit MCP Bridge - pyRevit Script

This script starts an HTTP server inside Revit that accepts requests from the
revit-mcp runtime. It runs on the Revit UI thread and handles Revit API calls.

Installation:
1. Install pyRevit (https://github.com/eirannejad/pyRevit)
2. Copy this folder to your pyRevit scripts directory
3. Run "Revit MCP Bridge" from the pyRevit ribbon

The server runs on http://127.0.0.1:8765 by default.
Set REVIT_MCP_PORT environment variable to change the port.
"""

import json
import os
import sys
import threading
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

REVIT_IMPORT_ERROR = None
try:
    import clr
    clr.AddReference("RevitAPI")
    clr.AddReference("RevitAPIUI")
    from Autodesk.Revit.DB import (
        BuiltInCategory,
        BuiltInParameter,
        Category,
        Connector,
        ConnectorType,
        CurveElement,
        DetailLine,
        Dimension,
        DimensionType,
        Document,
        Element,
        ElementId,
        ElementType,
        ElementTransformUtils,
        Family,
        FamilyInstance,
        FamilySymbol,
        FilteredElementCollector,
        IndependentTag,
        Level,
        Line,
        Location,
        LocationCurve,
        LocationPoint,
        MEPSystemType,
        MEPSystemClassification,
        Parameter,
        Reference,
        ReferenceArray,
        SpotDimension,
        SpotDimensionType,
        TagMode,
        TagOrientation,
        TextElement,
        TextNote,
        Transaction,
        TransactionStatus,
        UV,
        View,
        ViewType,
        XYZ,
    )
    from Autodesk.Revit.DB.Mechanical import Duct, DuctSystemType
    from Autodesk.Revit.DB.Plumbing import Pipe, PipingSystemType
    from Autodesk.Revit.UI import UIApplication
    REVIT_AVAILABLE = True
except Exception:
    # Keep the original traceback: ImportError alone cannot identify which
    # Revit API symbol or pyRevit CPython dependency was unavailable.
    REVIT_AVAILABLE = False
    REVIT_IMPORT_ERROR = traceback.format_exc()
    print("Revit MCP Bridge: Revit API import unavailable; refusing readiness.")


PORT = int(os.getenv("REVIT_MCP_PORT", "8765"))
_SERVER_THREAD = None
_SERVER_START_EVENT = threading.Event()
_SERVER_START_ERROR = None
_SERVER_READY = False
_APPDATA_ROOT = os.getenv("REVITGPT_APPDATA_ROOT") or os.path.join(
    os.getenv("LOCALAPPDATA") or os.path.expanduser("~"), "RevitGPT"
)
BRIDGE_LOG_PATH = os.path.join(_APPDATA_ROOT, "logs", "bridge.ndjson")


def bridge_log(event, **fields):
    try:
        log_dir = os.path.dirname(BRIDGE_LOG_PATH)
        if not os.path.isdir(log_dir):
            os.makedirs(log_dir)
        record = {"timestamp": datetime.utcnow().isoformat() + "Z", "event": event}
        record.update(fields)
        with open(BRIDGE_LOG_PATH, "a") as stream:
            stream.write(json.dumps(record, default=str) + "\n")
    except Exception:
        pass


MEP_CATEGORIES = {
    "duct": "Ducts",
    "duct_fitting": "Duct Fittings",
    "duct_accessory": "Duct Accessories",
    "pipe": "Pipes",
    "pipe_fitting": "Pipe Fittings",
    "pipe_accessory": "Pipe Accessories",
    "conduit": "Conduits",
    "conduit_fitting": "Conduit Fittings",
    "cable_tray": "Cable Trays",
    "cable_tray_fitting": "Cable Tray Fittings",
    "mechanical_equipment": "Mechanical Equipment",
    "plumbing_fixture": "Plumbing Fixtures",
    "sprinkler": "Sprinklers",
    "fire_alarm_device": "Fire Alarm Devices",
    "lighting_fixture": "Lighting Fixtures",
    "electrical_equipment": "Electrical Equipment",
    "electrical_fixture": "Electrical Fixtures",
}


def get_ui_app():
    if not REVIT_AVAILABLE:
        return None
    return UIApplication(__revit__)  # noqa: F821


def get_active_doc():
    uiapp = get_ui_app()
    if uiapp is None:
        return None
    uidoc = uiapp.ActiveUIDocument
    if uidoc is None:
        return None
    return uidoc.Document


def get_doc_by_id(doc_id: str):
    if not REVIT_AVAILABLE:
        return None
    uiapp = get_ui_app()
    if uiapp is None:
        return None
    for doc in uiapp.Application.Documents:
        if str(doc.Title) == doc_id or str(doc.GetHashCode()) == doc_id:
            return doc
    return None


def resolve_doc(doc_id: str = None):
    if doc_id:
        return get_doc_by_id(doc_id)
    return get_active_doc()


def doc_to_dict(doc) -> dict:
    if doc is None:
        return {"error": "No document available"}
    runtime_id = str(doc.GetHashCode())
    return {
        "id": runtime_id,
        "runtime_id": runtime_id,
        "title": doc.Title,
        "path": doc.PathName if doc.PathName else "",
        "is_workshared": bool(doc.IsWorkshared),
        "is_family_document": bool(getattr(doc, "IsFamilyDocument", False)),
        "is_read_only": bool(getattr(doc, "IsReadOnly", False)),
        "is_modified": bool(getattr(doc, "IsModified", False)),
        "is_linked": bool(getattr(doc, "IsLinked", False)),
        "revit_version": str(doc.Application.VersionNumber),
    }


def view_to_dict(view) -> dict:
    return {
        "id": str(view.Id.IntegerValue),
        "name": view.Name,
        "view_type": str(view.ViewType),
        "discipline": str(view.Discipline) if hasattr(view, "Discipline") else "",
    }


def level_to_dict(level) -> dict:
    return {
        "id": str(level.Id.IntegerValue),
        "name": level.Name,
        "elevation": level.Elevation,
    }


def read_param(param) -> object:
    storage = param.StorageType.ToString()
    if storage == "String":
        return param.AsString()
    elif storage == "Integer":
        return param.AsInteger()
    elif storage == "Double":
        return param.AsDouble()
    elif storage == "ElementId":
        return str(param.AsElementId().IntegerValue)
    return str(param.AsValueString())


def element_to_dict(elem, param_names: list = None) -> dict:
    result = {
        "id": str(elem.Id.IntegerValue),
        "category": elem.Category.Name if elem.Category else "",
        "class": elem.__class__.__name__,
    }

    if isinstance(elem, FamilyInstance):
        result["family"] = elem.Symbol.Family.Name if elem.Symbol else ""
        result["type"] = elem.Symbol.Name if elem.Symbol else ""
        result["family_id"] = str(elem.Symbol.Family.Id.IntegerValue) if elem.Symbol else ""
        result["type_id"] = str(elem.Symbol.Id.IntegerValue) if elem.Symbol else ""
    else:
        result["family"] = ""
        result["type"] = elem.Name if hasattr(elem, "Name") else ""
        result["family_id"] = ""
        result["type_id"] = ""

    loc = elem.Location
    if loc:
        if isinstance(loc, LocationPoint):
            pt = loc.Point
            result["location"] = {"x": pt.X, "y": pt.Y, "z": pt.Z, "type": "point"}
            result["rotation"] = loc.Rotation
        elif isinstance(loc, LocationCurve):
            curve = loc.Curve
            start = curve.GetEndPoint(0)
            end = curve.GetEndPoint(1)
            result["location"] = {
                "start": {"x": start.X, "y": start.Y, "z": start.Z},
                "end": {"x": end.X, "y": end.Y, "z": end.Z},
                "type": "curve",
            }
        else:
            result["location"] = None
    else:
        result["location"] = None

    if param_names:
        params = {}
        for pname in param_names:
            param = elem.LookupParameter(pname)
            if param:
                params[pname] = read_param(param)
        result["parameters"] = params

    return result


def family_type_to_dict(family_type) -> dict:
    result = {
        "id": str(family_type.Id.IntegerValue),
        "family": family_type.Family.Name if hasattr(family_type, "Family") else "",
        "type": family_type.Name,
        "class": family_type.__class__.__name__,
    }
    cat = family_type.Category
    if cat:
        result["category"] = cat.Name
    else:
        result["category"] = ""
    return result


def system_type_to_dict(st) -> dict:
    return {
        "id": str(st.Id.IntegerValue),
        "name": st.Name,
        "classification": str(st.SystemClassification) if hasattr(st, "SystemClassification") else "",
    }


def annotation_to_dict(elem) -> dict:
    result = {
        "id": str(elem.Id.IntegerValue),
        "class": elem.__class__.__name__,
    }

    if isinstance(elem, TextNote):
        result["type"] = "text_note"
        result["text"] = elem.Text if hasattr(elem, "Text") else ""
        loc = elem.Location
        if loc and isinstance(loc, LocationPoint):
            pt = loc.Point
            result["location"] = {"x": pt.X, "y": pt.Y, "z": pt.Z}
        result["view_id"] = str(elem.OwnerViewId.IntegerValue) if hasattr(elem, "OwnerViewId") else ""

    elif isinstance(elem, IndependentTag):
        result["type"] = "tag"
        result["tagged_element_id"] = str(elem.TaggedLocalElementId.IntegerValue) if hasattr(elem, "TaggedLocalElementId") else ""
        result["tag_head_family"] = ""
        result["tag_head_type"] = ""
        if hasattr(elem, "TagHeadFamilySymbol") and elem.TagHeadFamilySymbol:
            result["tag_head_family"] = elem.TagHeadFamilySymbol.Family.Name if elem.TagHeadFamilySymbol.Family else ""
            result["tag_head_type"] = elem.TagHeadFamilySymbol.Name
        result["view_id"] = str(elem.OwnerViewId.IntegerValue) if hasattr(elem, "OwnerViewId") else ""

    elif isinstance(elem, SpotDimension):
        result["type"] = "spot_dimension"
        result["view_id"] = str(elem.OwnerViewId.IntegerValue) if hasattr(elem, "OwnerViewId") else ""
        if hasattr(elem, "Value"):
            result["value"] = elem.Value
        if hasattr(elem, "ValueString"):
            result["value_string"] = elem.ValueString

    elif isinstance(elem, Dimension):
        result["type"] = "dimension"
        result["view_id"] = str(elem.OwnerViewId.IntegerValue) if hasattr(elem, "OwnerViewId") else ""
        if hasattr(elem, "Value"):
            result["value"] = elem.Value
        if hasattr(elem, "ValueString"):
            result["value_string"] = elem.ValueString

    elif isinstance(elem, DetailLine):
        result["type"] = "detail_line"
        result["view_id"] = str(elem.OwnerViewId.IntegerValue) if hasattr(elem, "OwnerViewId") else ""
        if hasattr(elem, "GeometryCurve"):
            curve = elem.GeometryCurve
            if isinstance(curve, Line):
                start = curve.GetEndPoint(0)
                end = curve.GetEndPoint(1)
                result["geometry"] = {
                    "start": {"x": start.X, "y": start.Y, "z": start.Z},
                    "end": {"x": end.X, "y": end.Y, "z": end.Z},
                }

    return result


def get_connectors_info(elem) -> list:
    connectors = []
    if not hasattr(elem, "MEPModel") or elem.MEPModel is None:
        return connectors
    try:
        mep_model = elem.MEPModel
        if not hasattr(mep_model, "ConnectorManager"):
            return connectors
        connector_mgr = mep_model.ConnectorManager
        for conn in connector_mgr.Connectors:
            conn_info = {
                "id": conn.Id,
                "connector_type": str(conn.ConnectorType),
                "direction": str(conn.Direction) if hasattr(conn, "Direction") else "",
                "coordinate": None,
            }
            if hasattr(conn, "Origin"):
                origin = conn.Origin
                conn_info["coordinate"] = {
                    "x": origin.X, "y": origin.Y, "z": origin.Z,
                }
            if hasattr(conn, "CoordinateSystem"):
                pass
            refs = []
            if hasattr(conn, "AllRefs"):
                for ref in conn.AllRefs:
                    refs.append({
                        "id": ref.Id,
                        "owner_id": str(ref.Owner.Id.IntegerValue) if ref.Owner else "",
                        "connector_type": str(ref.ConnectorType),
                    })
            conn_info["references"] = refs
            connectors.append(conn_info)
    except Exception:
        pass
    return connectors


def run_transaction(doc, name, func):
    t = Transaction(doc, name)
    try:
        t.Start()
        result = func()
        status = t.Commit()
        if status != TransactionStatus.Committed:
            t.RollBack()
            return {"committed": False, "status": str(status), "data": None}
        return {"committed": True, "status": "Committed", "data": result}
    except Exception as exc:
        if t.HasStarted() and not t.HasEnded():
            t.RollBack()
        raise exc


def find_category_id(doc, cat_name: str):
    for cat in doc.Settings.Categories:
        if cat.Name.lower() == cat_name.lower():
            return cat.Id
    mep_map = {
        "ducts": BuiltInCategory.OST_DuctCurves,
        "duct fittings": BuiltInCategory.OST_DuctFitting,
        "duct accessories": BuiltInCategory.OST_DuctAccessory,
        "pipes": BuiltInCategory.OST_PipeCurves,
        "pipe fittings": BuiltInCategory.OST_PipeFitting,
        "pipe accessories": BuiltInCategory.OST_PipeAccessory,
        "conduits": BuiltInCategory.OST_ConduitCurves,
        "conduit fittings": BuiltInCategory.OST_ConduitFitting,
        "cable trays": BuiltInCategory.OST_CableTray,
        "cable tray fittings": BuiltInCategory.OST_CableTrayFitting,
        "mechanical equipment": BuiltInCategory.OST_MechanicalEquipment,
        "plumbing fixtures": BuiltInCategory.OST_PlumbingFixtures,
        "sprinklers": BuiltInCategory.OST_Sprinklers,
        "lighting fixtures": BuiltInCategory.OST_LightingFixtures,
        "electrical equipment": BuiltInCategory.OST_ElectricalEquipment,
        "fire alarm devices": BuiltInCategory.OST_FireAlarmDevices,
    }
    bic = mep_map.get(cat_name.lower())
    if bic:
        return ElementId(bic)
    return None


class BridgeHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass

    def send_json(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def send_error_response(self, message: str, status: int = 500):
        bridge_log("error", method=getattr(self, "command", None), path=getattr(self, "path", None), status=status, error=message)
        self.send_json({"error": {"message": message, "code": status}}, status)

    def read_json_body(self) -> dict:
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        return json.loads(body.decode("utf-8"))

    def do_GET(self):
        path = self.path.split("?")[0]
        bridge_log("request", method="GET", path=path)

        try:
            if path == "/health":
                uiapp = get_ui_app()
                active_doc = get_active_doc()
                self.send_json({
                    "status": "ok",
                    "revit_available": REVIT_AVAILABLE,
                    "version": "1.2.0",
                    "process_id": os.getpid(),
                    "revit_version": (
                        str(uiapp.Application.VersionNumber)
                        if uiapp is not None
                        else ""
                    ),
                    "open_document_count": (
                        sum(1 for _ in uiapp.Application.Documents)
                        if uiapp is not None
                        else 0
                    ),
                    "active_document_id": (
                        str(active_doc.GetHashCode())
                        if active_doc is not None
                        else None
                    ),
                    "active_document_title": (
                        active_doc.Title
                        if active_doc is not None
                        else None
                    ),
                })
            elif path == "/document/active":
                doc = get_active_doc()
                self.send_json({"data": doc_to_dict(doc)})
            elif path == "/documents":
                if not REVIT_AVAILABLE:
                    self.send_json({"data": []})
                    return
                uiapp = get_ui_app()
                docs = [doc_to_dict(d) for d in uiapp.Application.Documents]
                self.send_json({"data": docs})
            elif path == "/views":
                doc = get_active_doc()
                if doc is None:
                    self.send_json({"data": []})
                    return
                collector = FilteredElementCollector(doc).OfClass(View)
                views = [view_to_dict(v) for v in collector if not v.IsTemplate]
                self.send_json({"data": views})
            elif path == "/levels":
                doc = get_active_doc()
                if doc is None:
                    self.send_json({"data": []})
                    return
                collector = FilteredElementCollector(doc).OfClass(Level)
                levels = [level_to_dict(l) for l in collector]
                self.send_json({"data": levels})
            else:
                self.send_error_response(f"Unknown endpoint: {path}", 404)
        except Exception as exc:
            self.send_error_response(f"{exc}\n{traceback.format_exc()}", 500)

    def do_POST(self):
        path = self.path.split("?")[0]
        bridge_log("request", method="POST", path=path)
        try:
            payload = self.read_json_body()
        except json.JSONDecodeError:
            self.send_error_response("Invalid JSON body", 400)
            return

        try:
            self._route_post(path, payload)
        except Exception as exc:
            self.send_error_response(f"{exc}\n{traceback.format_exc()}", 500)

    def _route_post(self, path, payload):
        if path == "/elements":
            self._handle_elements(payload)
        elif path == "/element":
            self._handle_element(payload)
        elif path == "/element/connectors":
            self._handle_element_connectors(payload)
        elif path == "/views":
            self._handle_views_post(payload)
        elif path == "/levels":
            self._handle_levels_post(payload)
        elif path == "/families":
            self._handle_families(payload)
        elif path == "/family/types":
            self._handle_family_types(payload)
        elif path == "/system/types":
            self._handle_system_types(payload)
        elif path == "/place":
            self._handle_place_instance(payload)
        elif path == "/create/duct":
            self._handle_create_duct(payload)
        elif path == "/create/pipe":
            self._handle_create_pipe(payload)
        elif path == "/parameter/set":
            self._handle_set_parameter(payload)
        elif path == "/delete":
            self._handle_delete(payload)
        elif path == "/move":
            self._handle_move(payload)
        elif path == "/annotations":
            self._handle_annotations(payload)
        elif path == "/annotation/text":
            self._handle_create_text_note(payload)
        elif path == "/annotation/tag":
            self._handle_create_tag(payload)
        elif path == "/annotation/dimension":
            self._handle_create_dimension(payload)
        elif path == "/annotation/spot_elevation":
            self._handle_create_spot_elevation(payload)
        elif path == "/annotation/detail_line":
            self._handle_create_detail_line(payload)
        else:
            self.send_error_response(f"Unknown endpoint: {path}", 404)

    def _handle_elements(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_json({"data": []})
            return

        collector = FilteredElementCollector(doc)

        if payload.get("view_id"):
            view_id = ElementId(int(payload["view_id"]))
            collector = FilteredElementCollector(doc, view_id)

        if payload.get("category"):
            cat_id = find_category_id(doc, payload["category"])
            if cat_id:
                collector = collector.OfCategoryId(cat_id)

        if payload.get("class"):
            class_name = payload["class"]
            class_map = {
                "FamilyInstance": FamilyInstance,
                "Level": Level,
                "View": View,
            }
            if REVIT_AVAILABLE:
                from Autodesk.Revit.DB import Wall, Floor
                class_map["Wall"] = Wall
                class_map["Floor"] = Floor
            if class_name in class_map:
                collector = collector.OfClass(class_map[class_name])

        elements = []
        param_names = payload.get("parameters", [])
        for elem in collector:
            elem_dict = element_to_dict(elem, param_names)
            if payload.get("family") and elem_dict.get("family") != payload["family"]:
                continue
            if payload.get("type") and elem_dict.get("type") != payload["type"]:
                continue
            elements.append(elem_dict)

        self.send_json({"data": elements})

    def _handle_element(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        elem_id = payload.get("element_id")
        if not elem_id:
            self.send_error_response("element_id is required", 400)
            return

        elem = doc.GetElement(ElementId(int(elem_id)))
        if elem is None:
            self.send_error_response(f"Element not found: {elem_id}", 404)
            return

        param_names = payload.get("parameters", [])
        result = element_to_dict(elem, param_names)
        if payload.get("include_connectors"):
            result["connectors"] = get_connectors_info(elem)
        self.send_json({"data": result})

    def _handle_element_connectors(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        elem_id = payload.get("element_id")
        if not elem_id:
            self.send_error_response("element_id is required", 400)
            return

        elem = doc.GetElement(ElementId(int(elem_id)))
        if elem is None:
            self.send_error_response(f"Element not found: {elem_id}", 404)
            return

        connectors = get_connectors_info(elem)
        self.send_json({"data": connectors})

    def _handle_views_post(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_json({"data": []})
            return
        collector = FilteredElementCollector(doc).OfClass(View)
        views = [view_to_dict(v) for v in collector if not v.IsTemplate]
        self.send_json({"data": views})

    def _handle_levels_post(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_json({"data": []})
            return
        collector = FilteredElementCollector(doc).OfClass(Level)
        levels = [level_to_dict(l) for l in collector]
        self.send_json({"data": levels})

    def _handle_families(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_json({"data": []})
            return

        collector = FilteredElementCollector(doc).OfClass(Family)
        families = []
        cat_filter = payload.get("category", "").lower()

        for fam in collector:
            fam_cat = fam.Category.Name if fam.Category else ""
            if cat_filter and fam_cat.lower() != cat_filter:
                continue
            fam_info = {
                "id": str(fam.Id.IntegerValue),
                "name": fam.Name,
                "category": fam_cat,
                "is_in_place": fam.IsInPlace,
                "family_file": fam.FamilyFilename if hasattr(fam, "FamilyFilename") else "",
            }
            families.append(fam_info)

        self.send_json({"data": families})

    def _handle_family_types(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_json({"data": []})
            return

        family_name = payload.get("family", "")
        category_filter = payload.get("category", "").lower()

        collector = FilteredElementCollector(doc).OfClass(FamilySymbol)
        types = []

        for fs in collector:
            fam = fs.Family
            fam_cat = fam.Category.Name if fam.Category else ""

            if family_name and fam.Name != family_name:
                continue
            if category_filter and fam_cat.lower() != category_filter:
                continue

            types.append(family_type_to_dict(fs))

        self.send_json({"data": types})

    def _handle_system_types(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_json({"data": []})
            return

        classification = payload.get("classification", "")

        collector = FilteredElementCollector(doc).OfClass(MEPSystemType)
        system_types = []

        for st in collector:
            if classification:
                st_class = str(st.SystemClassification) if hasattr(st, "SystemClassification") else ""
                if classification.lower() not in st_class.lower():
                    continue
            system_types.append(system_type_to_dict(st))

        self.send_json({"data": system_types})

    def _handle_place_instance(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        family_name = payload.get("family")
        type_name = payload.get("type")
        level_id_str = payload.get("level_id")
        x = float(payload.get("x", 0))
        y = float(payload.get("y", 0))
        z = float(payload.get("z", 0))
        rotation = float(payload.get("rotation", 0))

        if not family_name or not type_name:
            self.send_error_response("family and type are required", 400)
            return

        collector = FilteredElementCollector(doc).OfClass(FamilySymbol)
        symbol = None
        for fs in collector:
            if fs.Family.Name == family_name and fs.Name == type_name:
                symbol = fs
                break

        if symbol is None:
            self.send_error_response(
                f"Family type not found: {family_name} - {type_name}", 404
            )
            return

        if not symbol.IsActive:
            def activate_and_place():
                symbol.Activate()
                doc.Regenerate()
                level = None
                if level_id_str:
                    level = doc.GetElement(ElementId(int(level_id_str)))
                else:
                    levels_collector = FilteredElementCollector(doc).OfClass(Level)
                    for l in levels_collector:
                        level = l
                        break

                if level is None:
                    raise RuntimeError("No level found in document")

                pt = XYZ(x, y, z)
                instance = doc.Create.NewFamilyInstance(pt, symbol, level, None)
                if rotation != 0:
                    instance.Location.Rotate(
                        Line.CreateBound(pt, XYZ(pt.X, pt.Y, pt.Z + 1)),
                        rotation,
                    )
                return element_to_dict(instance)

            result = run_transaction(doc, "Place MEP Family Instance", activate_and_place)
        else:
            def place():
                level = None
                if level_id_str:
                    level = doc.GetElement(ElementId(int(level_id_str)))
                else:
                    levels_collector = FilteredElementCollector(doc).OfClass(Level)
                    for l in levels_collector:
                        level = l
                        break

                if level is None:
                    raise RuntimeError("No level found in document")

                pt = XYZ(x, y, z)
                instance = doc.Create.NewFamilyInstance(pt, symbol, level, None)
                if rotation != 0:
                    instance.Location.Rotate(
                        Line.CreateBound(pt, XYZ(pt.X, pt.Y, pt.Z + 1)),
                        rotation,
                    )
                return element_to_dict(instance)

            result = run_transaction(doc, "Place MEP Family Instance", place)

        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_create_duct(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        sx = float(payload.get("start_x", 0))
        sy = float(payload.get("start_y", 0))
        sz = float(payload.get("start_z", 0))
        ex = float(payload.get("end_x", 0))
        ey = float(payload.get("end_y", 0))
        ez = float(payload.get("end_z", 0))
        width = float(payload.get("width", 0.3))
        height = float(payload.get("height", 0.15))
        duct_type_name = payload.get("duct_type")
        system_type_name = payload.get("system_type")

        def create():
            start = XYZ(sx, sy, sz)
            end = XYZ(ex, ey, ez)
            line = Line.CreateBound(start, end)

            duct_type = None
            if duct_type_name:
                dt_collector = FilteredElementCollector(doc).OfClass(type(ElementType))
                for dt in dt_collector:
                    if dt.Name == duct_type_name:
                        duct_type = dt
                        break

            system_type = None
            if system_type_name:
                st_collector = FilteredElementCollector(doc).OfClass(MEPSystemType)
                for st in st_collector:
                    if st.Name == system_type_name:
                        system_type = st
                        break

            level = None
            level_id_str = payload.get("level_id")
            if level_id_str:
                level = doc.GetElement(ElementId(int(level_id_str)))

            if duct_type and system_type and level:
                duct = Duct.Create(doc, system_type.Id, duct_type.Id, level.Id, start, end)
            elif system_type and level:
                duct = Duct.Create(doc, system_type.Id, ElementId.InvalidElementId, level.Id, start, end)
            elif level:
                duct = Duct.Create(doc, ElementId.InvalidElementId, ElementId.InvalidElementId, level.Id, start, end)
            else:
                levels_collector = FilteredElementCollector(doc).OfClass(Level)
                for l in levels_collector:
                    level = l
                    break
                duct = Duct.Create(doc, ElementId.InvalidElementId, ElementId.InvalidElementId, level.Id, start, end)

            width_param = duct.LookupParameter("Width")
            if width_param and not width_param.IsReadOnly:
                width_param.Set(width)

            height_param = duct.LookupParameter("Height")
            if height_param and not height_param.IsReadOnly:
                height_param.Set(height)

            return element_to_dict(duct)

        result = run_transaction(doc, "Create Duct", create)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_create_pipe(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        sx = float(payload.get("start_x", 0))
        sy = float(payload.get("start_y", 0))
        sz = float(payload.get("start_z", 0))
        ex = float(payload.get("end_x", 0))
        ey = float(payload.get("end_y", 0))
        ez = float(payload.get("end_z", 0))
        diameter = float(payload.get("diameter", 0.05))
        pipe_type_name = payload.get("pipe_type")
        system_type_name = payload.get("system_type")

        def create():
            start = XYZ(sx, sy, sz)
            end = XYZ(ex, ey, ez)

            pipe_type = None
            if pipe_type_name:
                pt_collector = FilteredElementCollector(doc).OfClass(ElementType)
                for pt in pt_collector:
                    if pt.Name == pipe_type_name:
                        pipe_type = pt
                        break

            system_type = None
            if system_type_name:
                st_collector = FilteredElementCollector(doc).OfClass(MEPSystemType)
                for st in st_collector:
                    if st.Name == system_type_name:
                        system_type = st
                        break

            level = None
            level_id_str = payload.get("level_id")
            if level_id_str:
                level = doc.GetElement(ElementId(int(level_id_str)))

            if pipe_type and system_type and level:
                pipe = Pipe.Create(doc, system_type.Id, pipe_type.Id, level.Id, start, end)
            elif system_type and level:
                pipe = Pipe.Create(doc, system_type.Id, ElementId.InvalidElementId, level.Id, start, end)
            elif level:
                pipe = Pipe.Create(doc, ElementId.InvalidElementId, ElementId.InvalidElementId, level.Id, start, end)
            else:
                levels_collector = FilteredElementCollector(doc).OfClass(Level)
                for l in levels_collector:
                    level = l
                    break
                pipe = Pipe.Create(doc, ElementId.InvalidElementId, ElementId.InvalidElementId, level.Id, start, end)

            diam_param = pipe.LookupParameter("Diameter") or pipe.LookupParameter("Diam")
            if diam_param and not diam_param.IsReadOnly:
                diam_param.Set(diameter)

            return element_to_dict(pipe)

        result = run_transaction(doc, "Create Pipe", create)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_set_parameter(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        elem_id_str = payload.get("element_id")
        param_name = payload.get("parameter")
        value = payload.get("value")

        if not elem_id_str or not param_name:
            self.send_error_response("element_id and parameter are required", 400)
            return

        def set_param():
            elem = doc.GetElement(ElementId(int(elem_id_str)))
            if elem is None:
                raise RuntimeError(f"Element not found: {elem_id_str}")

            param = elem.LookupParameter(param_name)
            if param is None:
                raise RuntimeError(f"Parameter not found: {param_name}")

            if param.IsReadOnly:
                raise RuntimeError(f"Parameter is read-only: {param_name}")

            storage = param.StorageType.ToString()
            if storage == "String":
                param.Set(str(value))
            elif storage == "Integer":
                param.Set(int(value))
            elif storage == "Double":
                param.Set(float(value))
            elif storage == "ElementId":
                param.Set(ElementId(int(value)))
            else:
                raise RuntimeError(f"Unsupported storage type: {storage}")

            return {
                "element_id": elem_id_str,
                "parameter": param_name,
                "value": value,
                "storage_type": storage,
            }

        result = run_transaction(doc, f"Set Parameter: {param_name}", set_param)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_delete(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        element_ids = payload.get("element_ids", [])
        if not element_ids:
            single = payload.get("element_id")
            if single:
                element_ids = [single]
            else:
                self.send_error_response("element_id or element_ids required", 400)
                return

        def delete():
            deleted = []
            errors = []
            for eid_str in element_ids:
                try:
                    eid = ElementId(int(eid_str))
                    elem = doc.GetElement(eid)
                    if elem is None:
                        errors.append({"element_id": eid_str, "error": "Not found"})
                        continue
                    doc.Delete(eid)
                    deleted.append(eid_str)
                except Exception as exc:
                    errors.append({"element_id": eid_str, "error": str(exc)})
            return {
                "matched": len(element_ids),
                "deleted": len(deleted),
                "errors": len(errors),
                "deleted_ids": deleted,
                "error_details": errors,
            }

        result = run_transaction(doc, "Delete Elements", delete)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_move(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        elem_id_str = payload.get("element_id")
        if not elem_id_str:
            self.send_error_response("element_id is required", 400)
            return

        dx = float(payload.get("dx", 0))
        dy = float(payload.get("dy", 0))
        dz = float(payload.get("dz", 0))
        new_x = payload.get("x")
        new_y = payload.get("y")
        new_z = payload.get("z")

        def move():
            elem = doc.GetElement(ElementId(int(elem_id_str)))
            if elem is None:
                raise RuntimeError(f"Element not found: {elem_id_str}")

            loc = elem.Location
            if loc is None:
                raise RuntimeError("Element has no location")

            if isinstance(loc, LocationPoint):
                if new_x is not None and new_y is not None:
                    target = XYZ(float(new_x), float(new_y), float(new_z or loc.Point.Z))
                    offset = target - loc.Point
                    ElementTransformUtils.MoveElement(elem, offset)
                else:
                    offset = XYZ(dx, dy, dz)
                    ElementTransformUtils.MoveElement(elem, offset)
            elif isinstance(loc, LocationCurve):
                offset = XYZ(dx, dy, dz)
                ElementTransformUtils.MoveElement(elem, offset)
            else:
                raise RuntimeError("Unsupported location type for move")

            return element_to_dict(elem)

        result = run_transaction(doc, f"Move Element {elem_id_str}", move)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_annotations(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_json({"data": []})
            return

        view_id_str = payload.get("view_id")
        if not view_id_str:
            self.send_error_response("view_id is required", 400)
            return

        view = doc.GetElement(ElementId(int(view_id_str)))
        if view is None:
            self.send_error_response(f"View not found: {view_id_str}", 404)
            return

        annotation_type = payload.get("type", "")

        collector = FilteredElementCollector(doc, view.Id)

        annotations = []

        if annotation_type == "text" or annotation_type == "":
            text_notes = collector.OfClass(TextNote)
            for tn in text_notes:
                annotations.append(annotation_to_dict(tn))

        if annotation_type == "tag" or annotation_type == "":
            tags = collector.OfClass(IndependentTag)
            for tag in tags:
                annotations.append(annotation_to_dict(tag))

        if annotation_type == "dimension" or annotation_type == "":
            dims = collector.OfClass(Dimension)
            for dim in dims:
                annotations.append(annotation_to_dict(dim))

        if annotation_type == "spot_elevation" or annotation_type == "":
            spots = collector.OfClass(SpotDimension)
            for spot in spots:
                annotations.append(annotation_to_dict(spot))

        if annotation_type == "detail_line" or annotation_type == "":
            lines = collector.OfClass(DetailLine)
            for line in lines:
                annotations.append(annotation_to_dict(line))

        self.send_json({"data": annotations})

    def _handle_create_text_note(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        view_id_str = payload.get("view_id")
        if not view_id_str:
            self.send_error_response("view_id is required", 400)
            return

        view = doc.GetElement(ElementId(int(view_id_str)))
        if view is None:
            self.send_error_response(f"View not found: {view_id_str}", 404)
            return

        text = payload.get("text", "")
        x = float(payload.get("x", 0))
        y = float(payload.get("y", 0))
        z = float(payload.get("z", 0))
        note_type_name = payload.get("text_type")

        def create():
            note_type = None
            if note_type_name:
                types = FilteredElementCollector(doc).OfClass(TextNote)
                for t in types:
                    if t.Name == note_type_name:
                        note_type = t
                        break

            pt = XYZ(x, y, z)
            if note_type:
                note = TextNote.Create(doc, view.Id, pt, text, note_type.Id)
            else:
                note = TextNote.Create(doc, view.Id, pt, text)

            return annotation_to_dict(note)

        result = run_transaction(doc, "Create Text Note", create)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_create_tag(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        view_id_str = payload.get("view_id")
        if not view_id_str:
            self.send_error_response("view_id is required", 400)
            return

        view = doc.GetElement(ElementId(int(view_id_str)))
        if view is None:
            self.send_error_response(f"View not found: {view_id_str}", 404)
            return

        element_id_str = payload.get("element_id")
        if not element_id_str:
            self.send_error_response("element_id is required", 400)
            return

        elem = doc.GetElement(ElementId(int(element_id_str)))
        if elem is None:
            self.send_error_response(f"Element not found: {element_id_str}", 404)
            return

        x = float(payload.get("x", 0))
        y = float(payload.get("y", 0))
        z = float(payload.get("z", 0))
        tag_type_name = payload.get("tag_type")
        has_leader = payload.get("has_leader", False)

        def create():
            tag_type = None
            if tag_type_name:
                types = FilteredElementCollector(doc).OfClass(IndependentTag)
                for t in types:
                    if t.Name == tag_type_name:
                        tag_type = t
                        break

            pt = XYZ(x, y, z)
            ref = Reference(elem)

            if tag_type:
                tag = IndependentTag.Create(doc, tag_type.Id, view.Id, ref, has_leader, TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal)
                tag.TagHeadPosition = pt
            else:
                tag = IndependentTag.Create(doc, ElementId.InvalidElementId, view.Id, ref, has_leader, TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal)
                tag.TagHeadPosition = pt

            return annotation_to_dict(tag)

        result = run_transaction(doc, "Create Tag", create)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_create_dimension(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        view_id_str = payload.get("view_id")
        if not view_id_str:
            self.send_error_response("view_id is required", 400)
            return

        view = doc.GetElement(ElementId(int(view_id_str)))
        if view is None:
            self.send_error_response(f"View not found: {view_id_str}", 404)
            return

        dim_type_name = payload.get("dimension_type")
        references = payload.get("references", [])

        if len(references) < 2:
            self.send_error_response("At least 2 references are required", 400)
            return

        def create():
            dim_type = None
            if dim_type_name:
                types = FilteredElementCollector(doc).OfClass(DimensionType)
                for t in types:
                    if t.Name == dim_type_name:
                        dim_type = t
                        break

            ref_array = ReferenceArray()
            for ref_info in references:
                elem_id = ref_info.get("element_id")
                elem = doc.GetElement(ElementId(int(elem_id)))
                if elem:
                    ref_array.Append(Reference(elem))

            line = Line.CreateBound(XYZ(0, 0, 0), XYZ(1, 0, 0))

            if dim_type:
                dim = doc.Create.NewDimension(view, line, ref_array, dim_type)
            else:
                dim = doc.Create.NewDimension(view, line, ref_array)

            return annotation_to_dict(dim)

        result = run_transaction(doc, "Create Dimension", create)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_create_spot_elevation(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        view_id_str = payload.get("view_id")
        if not view_id_str:
            self.send_error_response("view_id is required", 400)
            return

        view = doc.GetElement(ElementId(int(view_id_str)))
        if view is None:
            self.send_error_response(f"View not found: {view_id_str}", 404)
            return

        element_id_str = payload.get("element_id")
        if not element_id_str:
            self.send_error_response("element_id is required", 400)
            return

        elem = doc.GetElement(ElementId(int(element_id_str)))
        if elem is None:
            self.send_error_response(f"Element not found: {element_id_str}", 404)
            return

        point_x = float(payload.get("point_x", 0))
        point_y = float(payload.get("point_y", 0))
        point_z = float(payload.get("point_z", 0))
        bend_x = float(payload.get("bend_x", 0))
        bend_y = float(payload.get("bend_y", 0))
        bend_z = float(payload.get("bend_z", 0))
        end_x = float(payload.get("end_x", 0))
        end_y = float(payload.get("end_y", 0))
        end_z = float(payload.get("end_z", 0))
        spot_type_name = payload.get("spot_type")

        def create():
            spot_type = None
            if spot_type_name:
                types = FilteredElementCollector(doc).OfClass(SpotDimensionType)
                for t in types:
                    if t.Name == spot_type_name:
                        spot_type = t
                        break

            point = XYZ(point_x, point_y, point_z)
            bend = XYZ(bend_x, bend_y, bend_z)
            end = XYZ(end_x, end_y, end_z)
            ref = Reference(elem)

            if spot_type:
                spot = doc.Create.NewSpotDimension(view, ref, point, bend, end, spot_type)
            else:
                spot = doc.Create.NewSpotDimension(view, ref, point, bend, end)

            return annotation_to_dict(spot)

        result = run_transaction(doc, "Create Spot Elevation", create)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)

    def _handle_create_detail_line(self, payload):
        doc = resolve_doc(payload.get("document_id"))
        if doc is None:
            self.send_error_response("No document available", 400)
            return

        view_id_str = payload.get("view_id")
        if not view_id_str:
            self.send_error_response("view_id is required", 400)
            return

        view = doc.GetElement(ElementId(int(view_id_str)))
        if view is None:
            self.send_error_response(f"View not found: {view_id_str}", 404)
            return

        start_x = float(payload.get("start_x", 0))
        start_y = float(payload.get("start_y", 0))
        start_z = float(payload.get("start_z", 0))
        end_x = float(payload.get("end_x", 0))
        end_y = float(payload.get("end_y", 0))
        end_z = float(payload.get("end_z", 0))
        line_style_name = payload.get("line_style")

        def create():
            start = XYZ(start_x, start_y, start_z)
            end = XYZ(end_x, end_y, end_z)
            line = Line.CreateBound(start, end)

            detail_line = doc.Create.NewDetailCurve(view, line)

            if line_style_name:
                gs = doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines)
                for subcat in gs.SubCategories:
                    if subcat.Name == line_style_name:
                        detail_line.LineStyle = doc.Settings.Categories.get_Item(subcat.Id)
                        break

            return annotation_to_dict(detail_line)

        result = run_transaction(doc, "Create Detail Line", create)
        if result["committed"]:
            self.send_json({"data": result["data"], "transaction": "committed"})
        else:
            self.send_error_response(f"Transaction failed: {result['status']}", 500)


def run_server():
    global _SERVER_START_ERROR, _SERVER_READY
    if not REVIT_AVAILABLE:
        _SERVER_READY = False
        _SERVER_START_ERROR = "Revit API import unavailable"
        bridge_log(
            "bridge_start_blocked",
            port=PORT,
            reason="revit_api_unavailable",
            import_error=REVIT_IMPORT_ERROR,
        )
        _SERVER_START_EVENT.set()
        return
    server = None
    try:
        server = HTTPServer(("127.0.0.1", PORT), BridgeHandler)
        _SERVER_READY = True
        _SERVER_START_ERROR = None
        bridge_log("bridge_start", port=PORT, revit_available=REVIT_AVAILABLE)
        print(f"Revit MCP Bridge running on http://127.0.0.1:{PORT}")
    except Exception as exc:
        _SERVER_READY = False
        _SERVER_START_ERROR = str(exc)
        bridge_log(
            "bridge_bind_failed",
            port=PORT,
            error=str(exc),
            traceback=traceback.format_exc(),
        )
        print(f"Revit MCP Bridge failed to bind 127.0.0.1:{PORT}: {exc}")
        _SERVER_START_EVENT.set()
        return

    _SERVER_START_EVENT.set()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        bridge_log("bridge_stop", reason="KeyboardInterrupt")
    except Exception as exc:
        bridge_log(
            "bridge_runtime_failed",
            port=PORT,
            error=str(exc),
            traceback=traceback.format_exc(),
        )
    finally:
        _SERVER_READY = False
        if server is not None:
            try:
                server.server_close()
            except Exception:
                pass


def ensure_server_started():
    global _SERVER_THREAD, _SERVER_START_ERROR, _SERVER_READY
    if not REVIT_AVAILABLE:
        _SERVER_READY = False
        _SERVER_START_ERROR = "Revit API import unavailable"
        bridge_log(
            "bridge_start_blocked",
            port=PORT,
            reason="revit_api_unavailable",
            import_error=REVIT_IMPORT_ERROR,
        )
        return {
            "started": False,
            "running": False,
            "ready": False,
            "port": PORT,
            "error": _SERVER_START_ERROR,
            "import_error": REVIT_IMPORT_ERROR,
        }
    if _SERVER_THREAD is not None and _SERVER_THREAD.is_alive() and _SERVER_READY:
        return {"started": False, "running": True, "ready": True, "port": PORT}

    _SERVER_START_EVENT.clear()
    _SERVER_START_ERROR = None
    _SERVER_READY = False
    _SERVER_THREAD = threading.Thread(target=run_server)
    _SERVER_THREAD.daemon = True
    _SERVER_THREAD.start()
    bridge_log("bridge_thread_started", port=PORT)

    if not _SERVER_START_EVENT.wait(2.0):
        bridge_log("bridge_start_timeout", port=PORT)
        return {
            "started": True,
            "running": _SERVER_THREAD.is_alive(),
            "ready": False,
            "port": PORT,
            "error": "bridge startup timed out",
        }

    if _SERVER_START_ERROR:
        return {
            "started": False,
            "running": False,
            "ready": False,
            "port": PORT,
            "error": _SERVER_START_ERROR,
        }

    return {
        "started": True,
        "running": _SERVER_THREAD.is_alive(),
        "ready": _SERVER_READY,
        "port": PORT,
    }


if __name__ == "__main__":
    run_server()
