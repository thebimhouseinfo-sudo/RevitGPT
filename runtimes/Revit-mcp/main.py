"""Start the Revit MCP server over stdio."""

from mcp.server.fastmcp import FastMCP

from tools import annotation_tools, document_tools, element_tools, family_tools, mep_tools, runtime_tools, view_tools


mcp = FastMCP("revit-mcp")
runtime_tools.register(mcp)
document_tools.register(mcp)
view_tools.register(mcp)
element_tools.register(mcp)
family_tools.register(mcp)
mep_tools.register(mcp)
annotation_tools.register(mcp)


if __name__ == "__main__":
    mcp.run(transport="stdio")
