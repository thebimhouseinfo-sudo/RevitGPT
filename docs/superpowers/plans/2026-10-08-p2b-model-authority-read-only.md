# P2B read-only model authority (source only)

P2A: user confirmed six of six real host binding scenarios.

- Native adds GET /binding/status and checks binding on every model read inside Revit ExternalEvent.
- Python route matches native route parity.
- Per-logical-MCP-session lease requires admission and explicit lease tool after user clicks Bind Current in Revit panel.
- Each model read rechecks bound ID, active ID, revision and host instance; conflicting document_id fails closed.
- Only diagnostics are allowed without a lease; all mutation tools are denied at Node and native writes remain 501.
- Rebinding, model closing, host restart and stale lease fail closed.

NOT yet integrated into a single panel click. Keep Bind Current (preview), not Lease + Bind Current.
Do not install this source change into active Revit. Two-disposable-RVT real MCP negative-control tests remain mandatory.
