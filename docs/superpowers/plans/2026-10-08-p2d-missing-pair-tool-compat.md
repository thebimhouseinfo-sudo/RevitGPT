# P2D correction — Pairing tool missing in ChatGPT catalogue

Observed Oct 8: The @rg connector exposes only the original four control
tools, though the Slim MCP source registers new named pairing tools. Python
Revit MCP reports 23 tools; this is a separate upstream inventory.

**Compatibility contract:** use the already-exposed `revitgpt_call` tool with
`name="revitgpt_pair_panel"` and `arguments={}`. The existing generic
proxy handles the alias directly in Slim MCP, NOT Python MCP, and returns a
single-use pairing code belonging to the invoking MCP server instance.

The same compatibility route applies to `revitgpt_binding_status` and
`revitgpt_lease_bound_model`. The existing `revitgpt_list_tools`
now separately advertises `slim_control_plane_tools`, while `tool_count`
of upstream Python MCP stays 23. All named and alias routes use a shared
handler and admission/lease requirements. The generic route cannot bypass
per-session authority or issue writes.

Host acceptance: pull/restart the Slim MCP after the new commit (no native
DLL reinstall needed if P2D 4dd4743 is already installed). In WebView2 @rg,
call admission, then generic alias to produce one-time code, pair panel,
bind RG-Test-A and assert other ChatGPT sessions are denied. Do not share
the pairing code in public messages or logs.
