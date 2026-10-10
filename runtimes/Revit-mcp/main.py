"""Start the Revit MCP server over stdio."""

from mcp.server.fastmcp import FastMCP

from tools import annotation_tools, document_tools, element_tools, family_tools, mep_tools, runtime_tools, view_tools, ui_tools, transform_tools, architecture_tools, parameter_write_tools, sheet_tools
from utils.logger import log_runtime


mcp = FastMCP("revit-mcp")
runtime_tools.register(mcp)
document_tools.register(mcp)
view_tools.register(mcp)
element_tools.register(mcp)
family_tools.register(mcp)
mep_tools.register(mcp)
annotation_tools.register(mcp)
ui_tools.register(mcp)
transform_tools.register(mcp)
architecture_tools.register(mcp)
parameter_write_tools.register(mcp)
sheet_tools.register(mcp)


if __name__ == "__main__":
    log_runtime("runtime_start", pid=__import__("os").getpid())
    try:
        mcp.run(transport="stdio")
    except Exception as exc:
        log_runtime("runtime_error", error=repr(exc))
        raise
    finally:
        log_runtime("runtime_stop")
