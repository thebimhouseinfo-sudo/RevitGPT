using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using Newtonsoft.Json;

namespace RevitGPT.Native
{
    // Local, bounded-frequency lifecycle evidence. Never logs ChatGPT content,
    // token, conversation URL or user RVT path. Logging errors never affect Revit.
    public static class NativePaneDiagnostics
    {
        private static readonly object Gate = new object();
        public static void Record(string stage, string detail = null, Exception error = null)
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RevitGPT", "logs");
                Directory.CreateDirectory(dir);
                string item = JsonConvert.SerializeObject(new {
                    time_utc = DateTimeOffset.UtcNow.ToString("o"),
                    process_id = Process.GetCurrentProcess().Id,
                    stage = stage,
                    detail = detail ?? "",
                    error_type = error == null ? "" : error.GetType().Name,
                    error_message = error == null ? "" :
                        (error.Message.Length > 400 ? error.Message.Substring(0, 400) : error.Message)
                });
                lock (Gate)
                    File.AppendAllText(Path.Combine(dir, "native-pane.ndjson"),
                        item + Environment.NewLine, new UTF8Encoding(false));
            }
            catch { /* Diagnostics must never break a loaded Revit add-in. */ }
        }
    }
}
