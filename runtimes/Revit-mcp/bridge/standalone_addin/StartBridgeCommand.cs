using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitMCPBridge
{
    /// <summary>
    /// External Application that starts when Revit loads.
    /// Creates a ribbon button to start the HTTP bridge.
    /// </summary>
    public class BridgeApplication : IExternalApplication
    {
        public static HttpServer Server;
        public static UIControlledApplication UiApp;

        public Result OnStartup(UIControlledApplication application)
        {
            UiApp = application;

            // Create ribbon panel and button
            try
            {
                RibbonPanel panel = application.CreateRibbonPanel("Revit MCP Bridge");
                PushButtonData buttonData = new PushButtonData(
                    "StartBridge",
                    "Start Bridge",
                    typeof(StartBridgeCommand).Assembly.Location,
                    typeof(StartBridgeCommand).FullName
                );
                PushButton button = panel.AddItem(buttonData) as PushButton;
                button.ToolTip = "Start the HTTP bridge server for MCP communication";
                button.LongDescription = "Click to start the HTTP bridge on http://127.0.0.1:8765";
            }
            catch (Exception ex)
            {
                // Button might already exist or other issue
                System.Diagnostics.Debug.WriteLine("Ribbon setup: " + ex.Message);
            }

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application)
        {
            Server?.Stop();
            return Result.Succeeded;
        }
    }

    /// <summary>
    /// Command triggered by ribbon button to start the bridge.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class StartBridgeCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                if (BridgeApplication.Server != null && BridgeApplication.Server.IsRunning)
                {
                    TaskDialog.Show("Revit MCP Bridge", "Bridge is already running on http://127.0.0.1:8765");
                    return Result.Succeeded;
                }

                BridgeApplication.Server = new HttpServer(commandData.Application);
                BridgeApplication.Server.Start();

                TaskDialog.Show("Revit MCP Bridge",
                    "Bridge started successfully!\n\n" +
                    "URL: http://127.0.0.1:8765\n\n" +
                    "The bridge is running in the background.");

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = "Failed to start: " + ex.Message;
                TaskDialog.Show("Revit MCP Bridge Error", ex.ToString());
                return Result.Failed;
            }
        }
    }

    /// <summary>
    /// HTTP server that processes requests in the UI thread via ExternalEvent.
    /// </summary>
    public class HttpServer
    {
        private readonly UIApplication _uiApp;
        private HttpListener _listener;
        private Thread _serverThread;
        private RequestHandler _handler;
        private ExternalEvent _externalEvent;

        public bool IsRunning { get; private set; }

        public HttpServer(UIApplication uiApp)
        {
            _uiApp = uiApp;
        }

        public void Start()
        {
            _handler = new RequestHandler(_uiApp);
            _externalEvent = ExternalEvent.Create(_handler);

            _listener = new HttpListener();
            _listener.Prefixes.Add("http://127.0.0.1:8765/");
            _listener.Start();

            _serverThread = new Thread(ServerLoop);
            _serverThread.IsBackground = true;
            _serverThread.Start();

            IsRunning = true;
        }

        public void Stop()
        {
            IsRunning = false;
            try { _listener?.Stop(); } catch { }
            try { _listener?.Close(); } catch { }
        }

        private void ServerLoop()
        {
            while (IsRunning && _listener != null && _listener.IsListening)
            {
                try
                {
                    var context = _listener.GetContext();
                    Task.Run(() => HandleRequest(context));
                }
                catch (Exception)
                {
                    break;
                }
            }
        }

        private void HandleRequest(HttpListenerContext context)
        {
            string responseText;
            int statusCode = 200;

            try
            {
                var request = context.Request;
                var path = request.Url.AbsolutePath;
                var method = request.HttpMethod;

                string requestBody = "";
                if (request.HasEntityBody)
                {
                    using (var reader = new StreamReader(request.InputStream, request.ContentEncoding))
                    {
                        requestBody = reader.ReadToEnd();
                    }
                }

                // Route request - mutating operations must run on UI thread
                responseText = _handler.ProcessRequest(path, method, requestBody, _externalEvent);
            }
            catch (Exception ex)
            {
                responseText = JsonConvert.SerializeObject(new { error = new { message = ex.Message, code = 500 } });
                statusCode = 500;
            }

            try
            {
                var buffer = Encoding.UTF8.GetBytes(responseText);
                context.Response.ContentType = "application/json";
                context.Response.ContentLength64 = buffer.Length;
                context.Response.StatusCode = statusCode;
                context.Response.OutputStream.Write(buffer, 0, buffer.Length);
                context.Response.OutputStream.Close();
            }
            catch { }
        }
    }

    /// <summary>
    /// Handles Revit API operations. Read operations can run on any thread;
    /// mutating operations must be queued to UI thread via ExternalEvent.
    /// </summary>
    public class RequestHandler : IExternalEventHandler
    {
        private readonly UIApplication _uiApp;

        public RequestHandler(UIApplication uiApp)
        {
            _uiApp = uiApp;
        }

        public string GetName() => "Revit MCP Bridge Handler";

        public void Execute(UIApplication uiApp)
        {
            // Process pending mutating request (set by ProcessRequest)
            if (_pendingMutateAction != null)
            {
                try
                {
                    _pendingResult = _pendingMutateAction(uiApp);
                }
                catch (Exception ex)
                {
                    _pendingResult = JsonConvert.SerializeObject(new { error = new { message = ex.Message, code = 500 } });
                }
                finally
                {
                    _pendingCompleted = true;
                    _pendingMutateAction = null;
                }
            }
        }

        private Func<UIApplication, string> _pendingMutateAction;
        private string _pendingResult;
        private bool _pendingCompleted;

        public string ProcessRequest(string path, string method, string body, ExternalEvent extEvent)
        {
            JObject payload = string.IsNullOrEmpty(body) ? new JObject() : JObject.Parse(body);

            // Read operations - safe to run anywhere
            if (path == "/health" || path == "/document/active" || path == "/documents" ||
                path == "/views" || path == "/levels" || path == "/elements" || path == "/element" ||
                path == "/families" || path == "/family/types" || path == "/annotations")
            {
                return RunRead(path, method, payload);
            }

            // Mutating operations - must run on UI thread
            if (path == "/place" || path == "/create/duct" || path == "/create/pipe" ||
                path == "/annotation/tag" || path == "/parameter/set" || path == "/delete" || path == "/move")
            {
                return RunMutate(path, payload, extEvent);
            }

            return JsonConvert.SerializeObject(new { error = new { message = "Unknown endpoint: " + path, code = 404 } });
        }

        private string RunRead(string path, string method, JObject payload)
        {
            try
            {
                if (path == "/health")
                    return JsonConvert.SerializeObject(new { status = "ok", version = "1.2.0", revit_available = true });
                if (path == "/document/active")
                    return HandleActiveDocument();
                if (path == "/view/active")
                    return HandleActiveView();
                if (path == "/documents")
                    return HandleDocuments();
                if (path == "/views")
                    return HandleViews();
                if (path == "/levels")
                    return HandleLevels();
                if (path == "/elements")
                    return HandleElements(payload);
                if (path == "/element")
                    return HandleElement(payload);
                if (path == "/elements/in_view")
                    return HandleElementsInView(payload);
                if (path == "/families")
                    return HandleFamilies(payload);
                if (path == "/family/types")
                    return HandleFamilyTypes(payload);
                if (path == "/annotations")
                    return HandleAnnotations(payload);
                if (path == "/tags/in_view")
                    return HandleTagsInView(payload);

                return JsonConvert.SerializeObject(new { error = new { message = "Not found", code = 404 } });
            }
            catch (Exception ex)
            {
                return JsonConvert.SerializeObject(new { error = new { message = ex.Message, code = 500 } });
            }
        }

        private string RunMutate(string path, JObject payload, ExternalEvent extEvent)
        {
            // Queue the mutating action to be executed on UI thread
            _pendingMutateAction = (uiApp) =>
            {
                var doc = uiApp.ActiveUIDocument?.Document;
                if (doc == null)
                    return JsonConvert.SerializeObject(new { error = new { message = "No active document", code = 400 } });

                if (path == "/place") return DoPlaceInstance(doc, payload);
                if (path == "/create/duct") return DoCreateDuct(doc, payload);
                if (path == "/create/pipe") return DoCreatePipe(doc, payload);
                if (path == "/annotation/tag") return DoCreateTag(doc, payload, uiApp);
                if (path == "/parameter/set") return DoSetParameter(doc, payload);
                if (path == "/delete") return DoDelete(doc, payload);
                if (path == "/move") return DoMove(doc, payload);

                return JsonConvert.SerializeObject(new { error = new { message = "Not implemented", code = 501 } });
            };
            _pendingCompleted = false;
            _pendingResult = null;

            // Raise the event
            extEvent.Raise();

            // Wait for completion (poll with short intervals, no blocking sleep)
            var startTime = DateTime.Now;
            while (!_pendingCompleted)
            {
                if ((DateTime.Now - startTime).TotalSeconds > 30)
                {
                    return JsonConvert.SerializeObject(new { error = new { message = "Request timeout", code = 504 } });
                }
                // Use Application.DoEvents equivalent - pump message queue
                Thread.Sleep(10);
                System.Windows.Forms.Application.DoEvents();
            }

            return _pendingResult ?? JsonConvert.SerializeObject(new { error = new { message = "No result", code = 500 } });
        }

        // ============ READ OPERATIONS ============

        private string HandleActiveDocument()
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null)
                return JsonConvert.SerializeObject(new { error = new { message = "No active document", code = 400 } });
            return JsonConvert.SerializeObject(new
            {
                data = new
                {
                    id = doc.GetHashCode().ToString(),
                    title = doc.Title,
                    path = doc.PathName ?? "",
                    is_workshared = doc.IsWorkshared,
                    revit_version = doc.Application.VersionNumber
                }
            });
        }

        private string HandleActiveView()
        {
            var view = _uiApp.ActiveUIDocument?.ActiveView;
            if (view == null)
                return JsonConvert.SerializeObject(new { error = new { message = "No active view", code = 400 } });
            return JsonConvert.SerializeObject(new
            {
                data = new
                {
                    id = view.Id.IntegerValue.ToString(),
                    name = view.Name,
                    view_type = view.ViewType.ToString()
                }
            });
        }

        private string HandleElementsInView(JObject payload)
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { data = new List<object>() });

            int viewId;
            if (payload["view_id"] != null)
                viewId = Convert.ToInt32(payload["view_id"]);
            else
            {
                var activeView = _uiApp.ActiveUIDocument?.ActiveView;
                if (activeView == null) return JsonConvert.SerializeObject(new { data = new List<object>() });
                viewId = activeView.Id.IntegerValue;
            }

            var view = doc.GetElement(new ElementId(viewId)) as View;
            if (view == null) return JsonConvert.SerializeObject(new { error = new { message = "View not found", code = 404 } });

            var categoryFilter = payload["category"]?.ToString();
            var elements = new List<object>();

            var collector = new FilteredElementCollector(doc, view.Id);
            if (!string.IsNullOrEmpty(categoryFilter))
            {
                foreach (Category cat in doc.Settings.Categories)
                {
                    if (cat.Name.Equals(categoryFilter, StringComparison.OrdinalIgnoreCase))
                    {
                        collector.OfCategoryId(cat.Id);
                        break;
                    }
                }
            }

            foreach (Element elem in collector)
            {
                elements.Add(ElementToDict(elem));
            }
            return JsonConvert.SerializeObject(new { data = elements, view_id = viewId, view_name = view.Name });
        }

        private string HandleTagsInView(JObject payload)
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { data = new List<object>() });

            int viewId;
            if (payload["view_id"] != null)
                viewId = Convert.ToInt32(payload["view_id"]);
            else
            {
                var activeView = _uiApp.ActiveUIDocument?.ActiveView;
                if (activeView == null) return JsonConvert.SerializeObject(new { data = new List<object>() });
                viewId = activeView.Id.IntegerValue;
            }

            var view = doc.GetElement(new ElementId(viewId)) as View;
            if (view == null) return JsonConvert.SerializeObject(new { error = new { message = "View not found", code = 404 } });

            var tags = new List<object>();
            var collector = new FilteredElementCollector(doc, view.Id).OfClass(typeof(IndependentTag));
            foreach (Element tag in collector)
            {
                object t;
                try
                {
                    var tagEl = (IndependentTag)tag;
                    var taggedIds = tagEl.GetTaggedElementIds();
                    var taggedIdStr = taggedIds.Count > 0 ? taggedIds.FirstOrDefault()?.HostElementId.IntegerValue.ToString() ?? "" : "";
                    var locPoint = tag.Location as LocationPoint;
                    t = new
                    {
                        id = tag.Id.IntegerValue.ToString(),
                        type = "tag",
                        class_name = "IndependentTag",
                        tagged_element_id = taggedIdStr,
                        location = locPoint != null ? new
                        {
                            x = locPoint.Point.X,
                            y = locPoint.Point.Y,
                            z = locPoint.Point.Z
                        } : null,
                        tag_head_position = tagEl.TagHeadPosition != null ? new
                        {
                            x = tagEl.TagHeadPosition.X,
                            y = tagEl.TagHeadPosition.Y,
                            z = tagEl.TagHeadPosition.Z
                        } : null,
                        has_leader = tagEl.HasLeader
                    };
                }
                catch
                {
                    var locPoint = tag.Location as LocationPoint;
                    t = new
                    {
                        id = tag.Id.IntegerValue.ToString(),
                        type = "tag",
                        class_name = "IndependentTag",
                        location = locPoint != null ? new
                        {
                            x = locPoint.Point.X,
                            y = locPoint.Point.Y,
                            z = locPoint.Point.Z
                        } : null
                    };
                }
                tags.Add(t);
            }
            return JsonConvert.SerializeObject(new { data = tags, view_id = viewId, view_name = view.Name });
        }

        private string HandleDocuments()
        {
            var docs = new List<object>();
            foreach (Document d in _uiApp.Application.Documents)
                docs.Add(new { id = d.GetHashCode().ToString(), title = d.Title, path = d.PathName ?? "" });
            return JsonConvert.SerializeObject(new { data = docs });
        }

        private string HandleViews()
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { data = new List<object>() });

            var collector = new FilteredElementCollector(doc).OfClass(typeof(View));
            var views = new List<object>();
            foreach (View v in collector)
            {
                if (!v.IsTemplate)
                    views.Add(new { id = v.Id.IntegerValue.ToString(), name = v.Name, view_type = v.ViewType.ToString() });
            }
            return JsonConvert.SerializeObject(new { data = views });
        }

        private string HandleLevels()
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { data = new List<object>() });

            var collector = new FilteredElementCollector(doc).OfClass(typeof(Level));
            var levels = new List<object>();
            foreach (Level l in collector)
                levels.Add(new { id = l.Id.IntegerValue.ToString(), name = l.Name, elevation = l.Elevation });
            return JsonConvert.SerializeObject(new { data = levels });
        }

        private string HandleElements(JObject payload)
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { data = new List<object>() });

            var collector = new FilteredElementCollector(doc);
            if (payload["category"] != null)
            {
                var catName = payload["category"].ToString();
                foreach (Category cat in doc.Settings.Categories)
                {
                    if (cat.Name.Equals(catName, StringComparison.OrdinalIgnoreCase))
                    {
                        collector = collector.OfCategoryId(cat.Id);
                        break;
                    }
                }
            }

            var elements = new List<object>();
            foreach (Element elem in collector)
                elements.Add(ElementToDict(elem));
            return JsonConvert.SerializeObject(new { data = elements });
        }

        private string HandleElement(JObject payload)
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { error = new { message = "No document", code = 400 } });
            if (payload["element_id"] == null) return JsonConvert.SerializeObject(new { error = new { message = "element_id required", code = 400 } });

            var elem = doc.GetElement(new ElementId(Convert.ToInt32(payload["element_id"])));
            if (elem == null) return JsonConvert.SerializeObject(new { error = new { message = "Not found", code = 404 } });
            return JsonConvert.SerializeObject(new { data = ElementToDict(elem) });
        }

        private string HandleFamilies(JObject payload)
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { data = new List<object>() });

            var collector = new FilteredElementCollector(doc).OfClass(typeof(Family));
            var families = new List<object>();
            var catFilter = payload["category"] != null ? payload["category"].ToString().ToLower() : "";

            foreach (Family fam in collector)
            {
                var catName = fam.Category != null ? fam.Category.Name : "";
                if (!string.IsNullOrEmpty(catFilter) && !catName.ToLower().Contains(catFilter))
                    continue;
                families.Add(new { id = fam.Id.IntegerValue.ToString(), name = fam.Name, category = catName, is_in_place = fam.IsInPlace });
            }
            return JsonConvert.SerializeObject(new { data = families });
        }

        private string HandleFamilyTypes(JObject payload)
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { data = new List<object>() });

            var collector = new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol));
            var types = new List<object>();
            var familyFilter = payload["family"] != null ? payload["family"].ToString() : "";

            foreach (FamilySymbol fs in collector)
            {
                if (!string.IsNullOrEmpty(familyFilter) && fs.Family.Name != familyFilter)
                    continue;
                types.Add(new { id = fs.Id.IntegerValue.ToString(), family = fs.Family.Name, type = fs.Name, category = fs.Category != null ? fs.Category.Name : "" });
            }
            return JsonConvert.SerializeObject(new { data = types });
        }

        private string HandleAnnotations(JObject payload)
        {
            var doc = _uiApp.ActiveUIDocument?.Document;
            if (doc == null) return JsonConvert.SerializeObject(new { data = new List<object>() });
            if (payload["view_id"] == null) return JsonConvert.SerializeObject(new { error = new { message = "view_id required", code = 400 } });

            var view = doc.GetElement(new ElementId(Convert.ToInt32(payload["view_id"]))) as View;
            if (view == null) return JsonConvert.SerializeObject(new { error = new { message = "View not found", code = 404 } });

            var collector = new FilteredElementCollector(doc, view.Id);
            var annotations = new List<object>();
            foreach (Element elem in collector.OfClass(typeof(IndependentTag)))
                annotations.Add(new { id = elem.Id.IntegerValue.ToString(), type = "tag" });
            foreach (Element elem in collector.OfClass(typeof(TextNote)))
                annotations.Add(new { id = elem.Id.IntegerValue.ToString(), type = "text_note" });
            return JsonConvert.SerializeObject(new { data = annotations });
        }

        // ============ MUTATE OPERATIONS (run on UI thread via ExternalEvent) ============

        private string DoPlaceInstance(Document doc, JObject payload)
        {
            string familyName = payload["family"]?.ToString() ?? "";
            string typeName = payload["type"]?.ToString() ?? "";
            double x = Convert.ToDouble(payload["x"] ?? 0);
            double y = Convert.ToDouble(payload["y"] ?? 0);
            double z = Convert.ToDouble(payload["z"] ?? 0);

            FamilySymbol symbol = null;
            foreach (FamilySymbol fs in new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)))
            {
                if (fs.Family.Name == familyName && fs.Name == typeName)
                {
                    symbol = fs;
                    break;
                }
            }

            if (symbol == null)
                return JsonConvert.SerializeObject(new { error = new { message = "Family type not found", code = 404 } });

            string elementId;
            using (var t = new Transaction(doc, "Place Family Instance"))
            {
                t.Start();
                if (!symbol.IsActive) symbol.Activate();
                var pt = new XYZ(x, y, z);
                var instance = doc.Create.NewFamilyInstance(pt, symbol, Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
                elementId = instance.Id.IntegerValue.ToString();
                t.Commit();
            }
            return JsonConvert.SerializeObject(new { data = ElementToDict(doc.GetElement(new ElementId(Convert.ToInt32(elementId)))), transaction = "committed" });
        }

        private string DoCreateDuct(Document doc, JObject payload)
        {
            double startX = Convert.ToDouble(payload["start_x"] ?? 0);
            double startY = Convert.ToDouble(payload["start_y"] ?? 0);
            double startZ = Convert.ToDouble(payload["start_z"] ?? 0);
            double endX = Convert.ToDouble(payload["end_x"] ?? 0);
            double endY = Convert.ToDouble(payload["end_y"] ?? 0);
            double endZ = Convert.ToDouble(payload["end_z"] ?? 0);
            double width = Convert.ToDouble(payload["width"] ?? 1.0);
            double height = Convert.ToDouble(payload["height"] ?? 0.5);

            Level level = null;
            if (payload["level_id"] != null)
                level = doc.GetElement(new ElementId(Convert.ToInt32(payload["level_id"]))) as Level;
            if (level == null)
                level = new FilteredElementCollector(doc).OfClass(typeof(Level)).FirstElement() as Level;
            if (level == null)
                return JsonConvert.SerializeObject(new { error = new { message = "No level found", code = 400 } });

            string ductId;
            using (var t = new Transaction(doc, "Create Duct"))
            {
                t.Start();
                var startPt = new XYZ(startX, startY, startZ);
                var endPt = new XYZ(endX, endY, endZ);

                var ductType = new FilteredElementCollector(doc).OfClass(typeof(DuctType)).FirstElement() as DuctType;
                var systemType = new FilteredElementCollector(doc).OfClass(typeof(MechanicalSystemType)).FirstElement() as MechanicalSystemType;

                if (ductType == null || systemType == null)
                {
                    t.RollBack();
                    return JsonConvert.SerializeObject(new { error = new { message = "No duct type or system type in project", code = 400 } });
                }

                var duct = Duct.Create(doc, systemType.Id, ductType.Id, level.Id, startPt, endPt);

                var widthParam = duct.get_Parameter(BuiltInParameter.RBS_CURVE_WIDTH_PARAM);
                if (widthParam != null && !widthParam.IsReadOnly) widthParam.Set(width);
                var heightParam = duct.get_Parameter(BuiltInParameter.RBS_CURVE_HEIGHT_PARAM);
                if (heightParam != null && !heightParam.IsReadOnly) heightParam.Set(height);

                ductId = duct.Id.IntegerValue.ToString();
                t.Commit();
            }
            return JsonConvert.SerializeObject(new { data = ElementToDict(doc.GetElement(new ElementId(Convert.ToInt32(ductId)))), transaction = "committed" });
        }

        private string DoCreatePipe(Document doc, JObject payload)
        {
            double startX = Convert.ToDouble(payload["start_x"] ?? 0);
            double startY = Convert.ToDouble(payload["start_y"] ?? 0);
            double startZ = Convert.ToDouble(payload["start_z"] ?? 0);
            double endX = Convert.ToDouble(payload["end_x"] ?? 0);
            double endY = Convert.ToDouble(payload["end_y"] ?? 0);
            double endZ = Convert.ToDouble(payload["end_z"] ?? 0);
            double diameter = Convert.ToDouble(payload["diameter"] ?? 0.5);

            Level level = null;
            if (payload["level_id"] != null)
                level = doc.GetElement(new ElementId(Convert.ToInt32(payload["level_id"]))) as Level;
            if (level == null)
                level = new FilteredElementCollector(doc).OfClass(typeof(Level)).FirstElement() as Level;
            if (level == null)
                return JsonConvert.SerializeObject(new { error = new { message = "No level found", code = 400 } });

            string pipeId;
            using (var t = new Transaction(doc, "Create Pipe"))
            {
                t.Start();
                var startPt = new XYZ(startX, startY, startZ);
                var endPt = new XYZ(endX, endY, endZ);

                var pipeType = new FilteredElementCollector(doc).OfClass(typeof(PipeType)).FirstElement() as PipeType;
                var systemType = new FilteredElementCollector(doc).OfClass(typeof(PipingSystemType)).FirstElement() as PipingSystemType;

                if (pipeType == null || systemType == null)
                {
                    t.RollBack();
                    return JsonConvert.SerializeObject(new { error = new { message = "No pipe type or system type in project", code = 400 } });
                }

                var pipe = Pipe.Create(doc, systemType.Id, pipeType.Id, level.Id, startPt, endPt);

                var diamParam = pipe.get_Parameter(BuiltInParameter.RBS_PIPE_DIAMETER_PARAM);
                if (diamParam != null && !diamParam.IsReadOnly) diamParam.Set(diameter);

                pipeId = pipe.Id.IntegerValue.ToString();
                t.Commit();
            }
            return JsonConvert.SerializeObject(new { data = ElementToDict(doc.GetElement(new ElementId(Convert.ToInt32(pipeId)))), transaction = "committed" });
        }

        private string DoCreateTag(Document doc, JObject payload, UIApplication uiApp)
        {
            if (payload["view_id"] == null || payload["element_id"] == null)
                return JsonConvert.SerializeObject(new { error = new { message = "view_id and element_id required", code = 400 } });

            int viewId = Convert.ToInt32(payload["view_id"]);
            int elemId = Convert.ToInt32(payload["element_id"]);
            double x = Convert.ToDouble(payload["x"] ?? 0);
            double y = Convert.ToDouble(payload["y"] ?? 0);

            var view = doc.GetElement(new ElementId(viewId)) as View;
            var elem = doc.GetElement(new ElementId(elemId));
            if (view == null || elem == null)
                return JsonConvert.SerializeObject(new { error = new { message = "View or element not found", code = 404 } });

            string tagId;
            using (var t = new Transaction(doc, "Create Tag"))
            {
                t.Start();
                var reference = new Reference(elem);
                var pt = new XYZ(x, y, 0);
                var tag = IndependentTag.Create(doc, view.Id, reference, true, TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal, pt);
                tagId = tag.Id.IntegerValue.ToString();
                t.Commit();
            }
            return JsonConvert.SerializeObject(new { data = new { id = tagId, tagged_element_id = elemId.ToString(), type = "tag" }, transaction = "committed" });
        }

        private string DoSetParameter(Document doc, JObject payload)
        {
            int elemId = Convert.ToInt32(payload["element_id"]);
            string paramName = payload["parameter"]?.ToString() ?? "";
            var value = payload["value"];

            var elem = doc.GetElement(new ElementId(elemId));
            if (elem == null) return JsonConvert.SerializeObject(new { error = new { message = "Element not found", code = 404 } });

            var param = elem.LookupParameter(paramName);
            if (param == null) return JsonConvert.SerializeObject(new { error = new { message = "Parameter not found", code = 404 } });

            using (var t = new Transaction(doc, "Set Parameter"))
            {
                t.Start();
                var storage = param.StorageType.ToString();
                if (storage == "String") param.Set(value?.ToString() ?? "");
                else if (storage == "Integer") param.Set(Convert.ToInt32(value));
                else if (storage == "Double") param.Set(Convert.ToDouble(value));
                else if (storage == "ElementId") param.Set(new ElementId(Convert.ToInt32(value)));
                t.Commit();
            }
            return JsonConvert.SerializeObject(new { data = new { element_id = elemId, parameter = paramName, value = value?.ToString() }, transaction = "committed" });
        }

        private string DoDelete(Document doc, JObject payload)
        {
            var ids = new List<int>();
            if (payload["element_ids"] != null)
                foreach (var id in payload["element_ids"]) ids.Add(Convert.ToInt32(id));
            else if (payload["element_id"] != null)
                ids.Add(Convert.ToInt32(payload["element_id"]));

            int deleted = 0;
            var errors = new List<object>();
            using (var t = new Transaction(doc, "Delete Elements"))
            {
                t.Start();
                foreach (var id in ids)
                {
                    try
                    {
                        doc.Delete(new ElementId(id));
                        deleted++;
                    }
                    catch (Exception ex)
                    {
                        errors.Add(new { id = id, error = ex.Message });
                    }
                }
                t.Commit();
            }
            return JsonConvert.SerializeObject(new { data = new { matched = ids.Count, deleted = deleted, errors = errors.Count, error_details = errors }, transaction = "committed" });
        }

        private string DoMove(Document doc, JObject payload)
        {
            int elemId = Convert.ToInt32(payload["element_id"]);
            double dx = Convert.ToDouble(payload["dx"] ?? 0);
            double dy = Convert.ToDouble(payload["dy"] ?? 0);
            double dz = Convert.ToDouble(payload["dz"] ?? 0);

            var elem = doc.GetElement(new ElementId(elemId));
            if (elem == null) return JsonConvert.SerializeObject(new { error = new { message = "Element not found", code = 404 } });

            using (var t = new Transaction(doc, "Move Element"))
            {
                t.Start();
                var offset = new XYZ(dx, dy, dz);
                ElementTransformUtils.MoveElement(doc, elem.Id, offset);
                t.Commit();
            }
            return JsonConvert.SerializeObject(new { data = ElementToDict(elem), transaction = "committed" });
        }

        // ============ HELPERS ============

        private Dictionary<string, object> ElementToDict(Element elem)
        {
            var result = new Dictionary<string, object>
            {
                ["id"] = elem.Id.IntegerValue.ToString(),
                ["category"] = elem.Category != null ? elem.Category.Name : "",
                ["class"] = elem.GetType().Name
            };

            if (elem is FamilyInstance fi)
            {
                result["family"] = fi.Symbol != null && fi.Symbol.Family != null ? fi.Symbol.Family.Name : "";
                result["type"] = fi.Symbol != null ? fi.Symbol.Name : "";
                result["family_id"] = fi.Symbol != null && fi.Symbol.Family != null ? fi.Symbol.Family.Id.IntegerValue.ToString() : "";
                result["type_id"] = fi.Symbol != null ? fi.Symbol.Id.IntegerValue.ToString() : "";
            }
            else
            {
                result["family"] = "";
                result["type"] = elem.Name != null ? elem.Name : "";
            }

            // Location with full details
            var loc = elem.Location;
            if (loc is LocationPoint lp)
            {
                result["location"] = new
                {
                    x = lp.Point.X,
                    y = lp.Point.Y,
                    z = lp.Point.Z,
                    rotation = lp.Rotation,
                    type = "point"
                };
            }
            else if (loc is LocationCurve lc)
            {
                var start = lc.Curve.GetEndPoint(0);
                var end = lc.Curve.GetEndPoint(1);
                result["location"] = new
                {
                    start = new { x = start.X, y = start.Y, z = start.Z },
                    end = new { x = end.X, y = end.Y, z = end.Z },
                    length = lc.Curve.Length,
                    type = "curve"
                };
            }

            // Key parameters for MEP elements
            var parameters = new Dictionary<string, object>();
            string[] paramNames = { "Width", "Height", "Diameter", "Length",
                                    "System Classification", "System Name",
                                    "System Type", "Flow", "Size" };
            foreach (var pname in paramNames)
            {
                var p = elem.LookupParameter(pname);
                if (p != null && p.HasValue)
                {
                    if (p.StorageType.ToString() == "Double")
                        parameters[pname] = p.AsDouble();
                    else if (p.StorageType.ToString() == "Integer")
                        parameters[pname] = p.AsInteger();
                    else if (p.StorageType.ToString() == "String")
                        parameters[pname] = p.AsString();
                }
            }
            if (parameters.Count > 0)
                result["parameters"] = parameters;

            // Connectors for MEP elements
            if (elem is FamilyInstance fi2 && fi2.MEPModel != null)
            {
                try
                {
                    var connMgr = fi2.MEPModel.ConnectorManager;
                    if (connMgr != null)
                    {
                        var conns = new List<object>();
                        foreach (Connector c in connMgr.Connectors)
                        {
                            var o = c.Origin;
                            var refIds = new List<object>();
                            foreach (Connector r in c.AllRefs)
                            {
                                refIds.Add(new
                                {
                                    owner_id = r.Owner != null ? r.Owner.Id.IntegerValue.ToString() : "",
                                    connector_type = r.ConnectorType.ToString()
                                });
                            }
                            conns.Add(new
                            {
                                id = c.Id,
                                type = c.ConnectorType.ToString(),
                                origin = new { x = o.X, y = o.Y, z = o.Z },
                                direction = c.Direction.ToString(),
                                radius = c.Radius,
                                refs = refIds
                            });
                        }
                        result["connectors"] = conns;
                    }
                }
                catch { }
            }

            // Rotation transform for FamilyInstance
            if (elem is FamilyInstance fi3)
            {
                try
                {
                    var t = fi3.GetTransform();
                    var basisX = t.BasisX;
                    var basisY = t.BasisY;
                    var basisZ = t.BasisZ;
                    var origin = t.Origin;
                    result["transform"] = new
                    {
                        origin = new { x = origin.X, y = origin.Y, z = origin.Z },
                        basis_x = new { x = basisX.X, y = basisX.Y, z = basisX.Z },
                        basis_y = new { x = basisY.X, y = basisY.Y, z = basisY.Z },
                        basis_z = new { x = basisZ.X, y = basisZ.Y, z = basisZ.Z }
                    };
                }
                catch { }
            }

            return result;
        }
    }
}
