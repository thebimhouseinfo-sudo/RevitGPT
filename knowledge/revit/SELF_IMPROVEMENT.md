# Revit MCP improvement loop

```text
real runtime/tool failure
-> structured error/tool-call evidence
-> classify known vs unknown
-> append failure knowledge
-> development-only revit-mcp-dev analysis
-> immutable source snapshot
-> narrow hash-guarded patch
-> compile/unit validation
-> real Revit validation when required
-> review/accept
-> promote stable lesson to Working Knowledge
```

Production mode never mutates Revit MCP source. Development mode is an explicit capability boundary.
