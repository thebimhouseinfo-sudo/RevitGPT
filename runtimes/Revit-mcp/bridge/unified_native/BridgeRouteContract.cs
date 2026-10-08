using System;
using System.Collections.Generic;

namespace RevitGPT.Native
{
    // Exact consumer surface is checked against connection/bridge.py in CI.
    // Route presence alone does NOT prove that an API handler is implemented.
    public static class BridgeRouteContract
    {
        private static readonly HashSet<string> Allowed = new HashSet<string>(StringComparer.Ordinal)
        {
            "GET /health",
            "GET /document/active",
            "GET /documents",
            "GET /views",
            "GET /levels",
            "POST /views",
            "POST /levels",
            "POST /elements",
            "POST /element",
            "POST /element/connectors",
            "POST /families",
            "POST /family/types",
            "POST /system/types",
            "POST /place",
            "POST /create/duct",
            "POST /create/pipe",
            "POST /parameter/set",
            "POST /delete",
            "POST /move",
            "POST /annotations",
            "POST /annotation/text",
            "POST /annotation/tag",
            "POST /annotation/dimension",
            "POST /annotation/spot_elevation",
            "POST /annotation/detail_line"
        };
        public static bool Supports(string method, string path)
        {
            return Allowed.Contains(method + " " + path);
        }
        public static bool KnownPath(string path)
        {
            foreach (var route in Allowed)
                if (route.EndsWith(" " + path, StringComparison.Ordinal)) return true;
            return false;
        }
    }
}
