"""Fake bridge tests for the Revit MCP runtime."""

import io
import json
import unittest
from urllib.error import HTTPError
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from unittest.mock import patch

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from connection.bridge import (
    RevitBridgeError,
    RevitBridgeUnavailableError,
    create_detail_line,
    create_dimension,
    create_duct,
    create_pipe,
    create_spot_elevation,
    create_tag,
    create_text_note,
    delete_elements,
    get_active_document,
    get_documents,
    get_annotations,
    get_element,
    get_element_connectors,
    get_elements,
    get_families,
    get_family_types,
    get_levels,
    get_system_types,
    get_views,
    health_check,
    move_element,
    place_family_instance,
    set_parameter,
)
from tools.runtime_tools import get_runtime_info


class FakeBridgeHandler(BaseHTTPRequestHandler):
    """Fake bridge for testing."""

    def log_message(self, format, *args):
        pass

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            self.send_json({
                "status": "ok",
                "version": "1.2.0",
                "process_id": 4321,
                "revit_version": "2024",
                "open_document_count": 2,
                "active_document_id": "12345",
                "active_document_title": "Test Project",
            })
        elif self.path == "/document/active":
            self.send_json({
                "data": {
                    "id": "12345",
                    "runtime_id": "12345",
                    "title": "Test Project",
                    "path": "C:/Projects/test.rvt",
                    "is_workshared": False,
                    "is_family_document": False,
                    "is_read_only": False,
                    "is_modified": False,
                    "is_linked": False,
                    "revit_version": "2024",
                }
            })
        elif self.path == "/documents":
            self.send_json({
                "data": [
                    {
                        "id": "12345",
                        "runtime_id": "12345",
                        "title": "Test Project",
                        "path": "C:/Projects/test.rvt",
                        "is_workshared": False,
                        "is_family_document": False,
                        "is_read_only": False,
                        "is_modified": False,
                        "is_linked": False,
                        "revit_version": "2024",
                    },
                    {
                        "id": "67890",
                        "runtime_id": "67890",
                        "title": "Another Project",
                        "path": "C:/Projects/another.rvt",
                        "is_workshared": True,
                        "is_family_document": False,
                        "is_read_only": False,
                        "is_modified": True,
                        "is_linked": False,
                        "revit_version": "2024",
                    },
                ]
            })
        elif self.path == "/views":
            self.send_json({
                "data": [
                    {"id": "100", "name": "Floor Plan: Level 1", "view_type": "FloorPlan"},
                    {"id": "101", "name": "Section 1", "view_type": "Section"},
                ]
            })
        elif self.path == "/levels":
            self.send_json({
                "data": [
                    {"id": "200", "name": "Level 1", "elevation": 0.0},
                    {"id": "201", "name": "Level 2", "elevation": 10.0},
                ]
            })
        else:
            self.send_json({"error": {"message": "Not found", "code": 404}}, 404)

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        payload = json.loads(body.decode("utf-8"))

        if self.path == "/elements":
            self.send_json({
                "data": [
                    {
                        "id": "300",
                        "category": "Walls",
                        "class": "Wall",
                        "family": "",
                        "type": "Basic Wall",
                    },
                    {
                        "id": "301",
                        "category": "Doors",
                        "class": "FamilyInstance",
                        "family": "Single-Flush",
                        "type": "0915 x 2134mm",
                    },
                ]
            })
        elif self.path == "/element":
            elem_id = payload.get("element_id")
            if elem_id == "999":
                self.send_json({"error": {"message": "Element not found", "code": 404}}, 404)
            else:
                self.send_json({
                    "data": {
                        "id": elem_id,
                        "category": "Walls",
                        "class": "Wall",
                        "family": "",
                        "type": "Basic Wall",
                        "parameters": {"Length": 10.5, "Height": 3.0},
                    }
                })
        elif self.path == "/element/connectors":
            self.send_json({
                "data": [
                    {
                        "id": 0,
                        "connector_type": "End",
                        "direction": "Incoming",
                        "coordinate": {"x": 0, "y": 0, "z": 0},
                        "references": [],
                    },
                    {
                        "id": 1,
                        "connector_type": "End",
                        "direction": "Outgoing",
                        "coordinate": {"x": 10, "y": 0, "z": 0},
                        "references": [{"id": 5, "owner_id": "400", "connector_type": "End"}],
                    },
                ]
            })
        elif self.path == "/families":
            self.send_json({
                "data": [
                    {"id": "500", "name": "AHU", "category": "Mechanical Equipment", "is_in_place": False, "family_file": "AHU.rfa"},
                    {"id": "501", "name": "FCU", "category": "Mechanical Equipment", "is_in_place": False, "family_file": "FCU.rfa"},
                    {"id": "502", "name": "Elbow - Round", "category": "Duct Fittings", "is_in_place": False, "family_file": "DuctFittings.rfa"},
                ]
            })
        elif self.path == "/family/types":
            self.send_json({
                "data": [
                    {"id": "600", "family": "AHU", "type": "AHU-01", "class": "FamilySymbol", "category": "Mechanical Equipment"},
                    {"id": "601", "family": "AHU", "type": "AHU-02", "class": "FamilySymbol", "category": "Mechanical Equipment"},
                    {"id": "602", "family": "FCU", "type": "FCU-01", "class": "FamilySymbol", "category": "Mechanical Equipment"},
                ]
            })
        elif self.path == "/system/types":
            self.send_json({
                "data": [
                    {"id": "700", "name": "Supply Air", "classification": "SupplyAir"},
                    {"id": "701", "name": "Return Air", "classification": "ReturnAir"},
                    {"id": "702", "name": "Domestic Cold Water", "classification": "DomesticColdWater"},
                ]
            })
        elif self.path == "/place":
            self.send_json({
                "data": {
                    "id": "800",
                    "category": "Mechanical Equipment",
                    "class": "FamilyInstance",
                    "family": payload.get("family", ""),
                    "type": payload.get("type", ""),
                    "family_id": "500",
                    "type_id": "600",
                    "location": {"x": payload.get("x", 0), "y": payload.get("y", 0), "z": payload.get("z", 0), "type": "point"},
                    "rotation": payload.get("rotation", 0),
                },
                "transaction": "committed",
            })
        elif self.path == "/create/duct":
            self.send_json({
                "data": {
                    "id": "801",
                    "category": "Ducts",
                    "class": "Duct",
                    "family": "",
                    "type": "Default Duct",
                    "family_id": "",
                    "type_id": "",
                    "location": {
                        "start": {"x": payload.get("start_x"), "y": payload.get("start_y"), "z": payload.get("start_z")},
                        "end": {"x": payload.get("end_x"), "y": payload.get("end_y"), "z": payload.get("end_z")},
                        "type": "curve",
                    },
                },
                "transaction": "committed",
            })
        elif self.path == "/create/pipe":
            self.send_json({
                "data": {
                    "id": "802",
                    "category": "Pipes",
                    "class": "Pipe",
                    "family": "",
                    "type": "Default Pipe",
                    "family_id": "",
                    "type_id": "",
                    "location": {
                        "start": {"x": payload.get("start_x"), "y": payload.get("start_y"), "z": payload.get("start_z")},
                        "end": {"x": payload.get("end_x"), "y": payload.get("end_y"), "z": payload.get("end_z")},
                        "type": "curve",
                    },
                },
                "transaction": "committed",
            })
        elif self.path == "/parameter/set":
            self.send_json({
                "data": {
                    "element_id": payload.get("element_id"),
                    "parameter": payload.get("parameter"),
                    "value": payload.get("value"),
                    "storage_type": "Double",
                },
                "transaction": "committed",
            })
        elif self.path == "/delete":
            ids = payload.get("element_ids", [])
            self.send_json({
                "data": {
                    "matched": len(ids),
                    "deleted": len(ids),
                    "errors": 0,
                    "deleted_ids": ids,
                    "error_details": [],
                },
                "transaction": "committed",
            })
        elif self.path == "/move":
            self.send_json({
                "data": {
                    "id": payload.get("element_id"),
                    "category": "Mechanical Equipment",
                    "class": "FamilyInstance",
                    "family": "AHU",
                    "type": "AHU-01",
                    "family_id": "500",
                    "type_id": "600",
                    "location": {"x": payload.get("x", 0), "y": payload.get("y", 0), "z": payload.get("z", 0), "type": "point"},
                    "rotation": 0,
                },
                "transaction": "committed",
            })
        elif self.path == "/views":
            self.send_json({
                "data": [
                    {"id": "100", "name": "Floor Plan: Level 1", "view_type": "FloorPlan"},
                ]
            })
        elif self.path == "/levels":
            self.send_json({
                "data": [
                    {"id": "200", "name": "Level 1", "elevation": 0.0},
                ]
            })
        elif self.path == "/annotations":
            self.send_json({
                "data": [
                    {"id": "900", "class": "TextNote", "type": "text_note", "text": "Sample note", "location": {"x": 0, "y": 0, "z": 0}, "view_id": "100"},
                    {"id": "901", "class": "IndependentTag", "type": "tag", "tagged_element_id": "800", "tag_head_family": "Duct Tag", "tag_head_type": "Default", "view_id": "100"},
                ]
            })
        elif self.path == "/annotation/text":
            self.send_json({
                "data": {
                    "id": "910",
                    "class": "TextNote",
                    "type": "text_note",
                    "text": payload.get("text", ""),
                    "location": {"x": payload.get("x", 0), "y": payload.get("y", 0), "z": payload.get("z", 0)},
                    "view_id": payload.get("view_id"),
                },
                "transaction": "committed",
            })
        elif self.path == "/annotation/tag":
            self.send_json({
                "data": {
                    "id": "911",
                    "class": "IndependentTag",
                    "type": "tag",
                    "tagged_element_id": payload.get("element_id"),
                    "tag_head_family": "Duct Tag",
                    "tag_head_type": "Default",
                    "view_id": payload.get("view_id"),
                },
                "transaction": "committed",
            })
        elif self.path == "/annotation/dimension":
            self.send_json({
                "data": {
                    "id": "912",
                    "class": "Dimension",
                    "type": "dimension",
                    "value": 10.0,
                    "value_string": "10' - 0\"",
                    "view_id": payload.get("view_id"),
                },
                "transaction": "committed",
            })
        elif self.path == "/annotation/spot_elevation":
            self.send_json({
                "data": {
                    "id": "913",
                    "class": "SpotDimension",
                    "type": "spot_dimension",
                    "value": 100.0,
                    "value_string": "100' - 0\"",
                    "view_id": payload.get("view_id"),
                },
                "transaction": "committed",
            })
        elif self.path == "/annotation/detail_line":
            self.send_json({
                "data": {
                    "id": "914",
                    "class": "DetailLine",
                    "type": "detail_line",
                    "view_id": payload.get("view_id"),
                    "geometry": {
                        "start": {"x": payload.get("start_x", 0), "y": payload.get("start_y", 0), "z": payload.get("start_z", 0)},
                        "end": {"x": payload.get("end_x", 0), "y": payload.get("end_y", 0), "z": payload.get("end_z", 0)},
                    },
                },
                "transaction": "committed",
            })
        else:
            self.send_json({"error": {"message": "Not found", "code": 404}}, 404)


class FakeBridgeTests(unittest.TestCase):
    """Tests using a fake HTTP bridge."""

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeBridgeHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = Thread(target=cls.server.serve_forever)
        cls.thread.daemon = True
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()

    def setUp(self):
        self.patcher = patch("connection.bridge.BRIDGE_URL", f"http://127.0.0.1:{self.port}")
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()

    def test_health_check(self):
        result = health_check()
        self.assertTrue(result["available"])
        self.assertEqual(result["bridge"]["status"], "ok")

    def test_get_active_document(self):
        result = get_active_document()
        self.assertEqual(result["title"], "Test Project")
        self.assertEqual(result["revit_version"], "2024")
        self.assertEqual(result["runtime_id"], "12345")

    def test_get_documents(self):
        result = get_documents()
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["runtime_id"], "12345")
        self.assertEqual(result[1]["is_workshared"], True)

    def test_runtime_info_includes_document_diagnostics(self):
        result = get_runtime_info()
        self.assertEqual(result["document_access"], "available")
        self.assertEqual(result["bridge"]["process_id"], 4321)
        self.assertEqual(result["active_document"]["runtime_id"], "12345")
        self.assertEqual(len(result["open_documents"]), 2)

    def test_get_views(self):
        result = get_views()
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["name"], "Floor Plan: Level 1")

    def test_get_levels(self):
        result = get_levels()
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["elevation"], 0.0)

    def test_get_elements(self):
        result = get_elements()
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["category"], "Walls")

    def test_get_element(self):
        result = get_element("300")
        self.assertEqual(result["id"], "300")
        self.assertIn("parameters", result)

    def test_get_element_not_found(self):
        with self.assertRaises(RevitBridgeError):
            get_element("999")

    def test_get_element_connectors(self):
        result = get_element_connectors("300")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["connector_type"], "End")
        self.assertEqual(len(result[1]["references"]), 1)

    def test_get_families(self):
        result = get_families()
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["name"], "AHU")
        self.assertEqual(result[0]["category"], "Mechanical Equipment")

    def test_get_families_by_category(self):
        result = get_families(category="Mechanical Equipment")
        self.assertEqual(len(result), 3)

    def test_get_family_types(self):
        result = get_family_types(family="AHU")
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["type"], "AHU-01")

    def test_get_system_types(self):
        result = get_system_types()
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["name"], "Supply Air")

    def test_get_system_types_by_classification(self):
        result = get_system_types(classification="SupplyAir")
        self.assertEqual(len(result), 3)

    def test_place_family_instance(self):
        result = place_family_instance(
            family="AHU",
            type="AHU-01",
            x=10.0,
            y=20.0,
            z=0.0,
        )
        self.assertEqual(result["id"], "800")
        self.assertEqual(result["family"], "AHU")
        self.assertEqual(result["location"]["x"], 10.0)

    def test_create_duct(self):
        result = create_duct(
            start_x=0, start_y=0, start_z=10,
            end_x=20, end_y=0, end_z=10,
            width=1.0,
            height=0.5,
        )
        self.assertEqual(result["id"], "801")
        self.assertEqual(result["category"], "Ducts")
        self.assertEqual(result["location"]["type"], "curve")

    def test_create_pipe(self):
        result = create_pipe(
            start_x=0, start_y=0, start_z=5,
            end_x=15, end_y=0, end_z=5,
            diameter=0.1,
        )
        self.assertEqual(result["id"], "802")
        self.assertEqual(result["category"], "Pipes")

    def test_set_parameter(self):
        result = set_parameter(
            element_id="300",
            parameter="Width",
            value=1.5,
        )
        self.assertEqual(result["element_id"], "300")
        self.assertEqual(result["parameter"], "Width")
        self.assertEqual(result["value"], 1.5)

    def test_delete_elements(self):
        result = delete_elements(element_ids=["300", "301"])
        self.assertEqual(result["matched"], 2)
        self.assertEqual(result["deleted"], 2)
        self.assertEqual(result["errors"], 0)

    def test_move_element(self):
        result = move_element(
            element_id="800",
            dx=5.0,
            dy=0,
            dz=0,
        )
        self.assertEqual(result["id"], "800")

    def test_get_annotations(self):
        result = get_annotations(view_id="100")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["type"], "text_note")
        self.assertEqual(result[1]["type"], "tag")

    def test_create_text_note(self):
        result = create_text_note(
            view_id="100",
            text="Test annotation",
            x=5.0,
            y=10.0,
            z=0.0,
        )
        self.assertEqual(result["id"], "910")
        self.assertEqual(result["text"], "Test annotation")
        self.assertEqual(result["type"], "text_note")

    def test_create_tag(self):
        result = create_tag(
            view_id="100",
            element_id="800",
            x=5.0,
            y=10.0,
            z=0.0,
        )
        self.assertEqual(result["id"], "911")
        self.assertEqual(result["tagged_element_id"], "800")
        self.assertEqual(result["type"], "tag")

    def test_create_dimension(self):
        result = create_dimension(
            view_id="100",
            references=[{"stable_reference": "300:0:FACE"}, {"stable_reference": "301:0:FACE"}],
            line_start={"x": 0, "y": 0, "z": 0},
            line_end={"x": 10, "y": 0, "z": 0},
        )
        self.assertEqual(result["id"], "912")
        self.assertEqual(result["type"], "dimension")
        self.assertEqual(result["value"], 10.0)

    def test_create_spot_elevation(self):
        result = create_spot_elevation(
            view_id="100",
            element_id="300",
            point_x=0, point_y=0, point_z=0,
            bend_x=1, bend_y=0, bend_z=0,
            end_x=2, end_y=0, end_z=0,
            stable_reference="300:0:FACE",
        )
        self.assertEqual(result["id"], "913")
        self.assertEqual(result["type"], "spot_dimension")
        self.assertEqual(result["value"], 100.0)

    def test_create_detail_line(self):
        result = create_detail_line(
            view_id="100",
            start_x=0, start_y=0, start_z=0,
            end_x=10, end_y=0, end_z=0,
        )
        self.assertEqual(result["id"], "914")
        self.assertEqual(result["type"], "detail_line")


class NativeErrorClassificationTests(unittest.TestCase):
    """HTTP integration boundary: API failures are not transport outages."""

    @staticmethod
    def error_response(status, content):
        if isinstance(content, dict):
            content = json.dumps(content)
        return HTTPError(
            "http://127.0.0.1:8765/test", status, "mock response", {},
            io.BytesIO(content.encode("utf-8")),
        )

    def test_501_native_write_disabled_is_api_error_not_connection_loss(self):
        response = self.error_response(
            501, {"error": {"code": 501, "message": "Native write route not yet validated."}}
        )
        with patch("connection.bridge.urlopen", side_effect=response) as transport:
            with self.assertRaisesRegex(RevitBridgeError, "HTTP 501.*not yet validated"):
                delete_elements(["101"])
        transport.assert_called_once()

    def test_504_write_timeout_preserves_ambiguous_outcome_and_no_retry(self):
        response = self.error_response(
            504, {"error": {"code": 504, "message":
                "Revit write timed out; outcome unknown; do not retry automatically."}}
        )
        with patch("connection.bridge.urlopen", side_effect=response) as transport:
            with self.assertRaisesRegex(
                RevitBridgeError, "outcome unknown; do not retry automatically"
            ):
                delete_elements(["101"])
        transport.assert_called_once()

    def test_504_empty_body_still_fails_closed_without_retry(self):
        response = self.error_response(504, "upstream timeout")
        with patch("connection.bridge.urlopen", side_effect=response) as transport:
            with self.assertRaisesRegex(
                RevitBridgeError, "outcome unknown; do not retry automatically"
            ):
                delete_elements(["101"])
        transport.assert_called_once()

    def test_404_router_error_still_is_bridge_error(self):
        response = self.error_response(
            404, {"error": {"code": 404, "message": "Target Revit document is not open."}}
        )
        with patch("connection.bridge.urlopen", side_effect=response):
            with self.assertRaisesRegex(RevitBridgeError, "HTTP 404.*not open"):
                get_active_document()

    def test_unstructured_http_503_remains_unavailable(self):
        response = self.error_response(503, "Gateway unavailable")
        with patch("connection.bridge.urlopen", side_effect=response):
            with self.assertRaises(RevitBridgeUnavailableError):
                get_active_document()


class UnavailableBridgeTests(unittest.TestCase):
    """Tests for bridge unavailability."""

    def setUp(self):
        self.patcher = patch("connection.bridge.BRIDGE_URL", "http://127.0.0.1:1")
        self.patcher.start()
        self.timeout_patcher = patch("connection.bridge.BRIDGE_TIMEOUT_SECONDS", 0.1)
        self.timeout_patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.timeout_patcher.stop()

    def test_health_check_unavailable(self):
        result = health_check()
        self.assertFalse(result["available"])
        self.assertIn("error", result)

    def test_get_active_document_unavailable(self):
        with self.assertRaises(RevitBridgeUnavailableError):
            get_active_document()


if __name__ == "__main__":
    unittest.main()
