# Revit MCP migration baseline

## Provenance

Source reference: `thebimhouseinfo-sudo/CAD-Agent/runtimes/Revit-mcp`.

Human has confirmed that this Revit MCP was used against real Revit models for
read, write, and delete operations. RevitGPT therefore treats it as the proven
capability baseline rather than redesigning the bridge from assumptions.

## P1 bootstrap policy

- Preserve the Python MCP -> services -> bridge client -> Revit bridge chain.
- Use the pyRevit bridge first for live capability regression.
- Do not hardcode a final RVT binding/lease architecture yet.
- Do not treat active Revit view/tab/window as model authority.
- Do not activate the old standalone C# add-in as the default until the actual
  Revit host version and required .NET target are measured.
- Production self-modification is out of scope; future `revit-mcp-dev` is a
  development-only capability.

## Next evidence gate

On a real RVT model prove:

1. bridge health;
2. list open RVT models/documents;
3. read;
4. controlled write;
5. controlled delete;
6. record actual Revit version/process/model identity fields.

Only then harden admission, model binding, and the 15-minute chat lease.


## Lifecycle correction

Bridge connectivity is not lifecycle authority.

- A bridge health failure or bridge restart does **not** prove that Revit is OFF.
- Once the full Revit MCP has been activated, bridge loss alone must not stop it.
- Full MCP shutdown requires an actual Revit-OFF signal or the observable GPT/plugin-runtime end signal established by E2.
- Lease expiry/release is also independent and never shuts down the full MCP.
