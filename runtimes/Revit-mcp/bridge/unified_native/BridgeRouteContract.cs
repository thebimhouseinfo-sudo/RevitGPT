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
            "GET /binding/status",
            "GET /documents",
            "GET /views",
            "GET /levels",
            "POST /views",
            "POST /levels",
            "POST /elements",
            "POST /elements/aggregate",
            "POST /ui/selection",
            "POST /ui/selection/set",
            "POST /ui/show",
            "POST /ui/view/activate",
            "POST /ui/visibility/temporary",
            "POST /ui/select-related",
            "POST /element",
            "POST /element/parameters",
            "POST /element/inspect",
            "POST /categories",
            "POST /element/connectors",
            "POST /mep/systems",
            "POST /mep/quantities",
            "POST /model/spatial-warnings",
            "POST /view/properties",
            "POST /sheets",
            "POST /sheet/viewports",
            "POST /sheet/write",
            "POST /view/format",
            "POST /families",
            "POST /family/types",
            "POST /system/types",
            "POST /place",
            "POST /create/duct",
            "POST /create/pipe",
            "POST /parameter/set",
            "POST /parameter/batch",
            "POST /parameter/copy",
            "POST /delete",
            "POST /move",
            "POST /transform",
            "POST /architecture/create",
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
