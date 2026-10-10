# RevitGPT official local installation (no distributable packaging)

Decision: UI is stable WebView2. Promote native add-in to locally installed
product (not a ZIP, MSI or EXE). Core MCP may update independently of native
host except when host APIs actually change.

Installer CLI: `scripts/manage-native-revitgpt-install.ps1` with
`Validate|Install|Uninstall`, `-SourceDirectory`, `-Version`,
`-ApproveHostChange` and explicit `-MigratePreview`. Keeps immutable
per-version DLL copies and registered user-scoped `RevitGPT.addin`, stable
AddInId and host class, backups of both preview and prior installed manifest.
No automatic collision removal. Existing preview is NOT migrated without a
user action, and files are never patched while Revit is running.

## Write/Edit decision
Do not confuse an installed product with a validated mutation implementation:
`SessionModelAuthority.authorize()` denies mutations, and the native
`RevitApiRouter.Execute()` returns 501 for all write paths. RevitGPT will
move to **per-capability write contracts** rather than a product-level
read-only identity. This means each tool may be made write-capable only when
its native API implementation, Revit Transaction, binding enforcement,
idempotency/retry semantics, and rollback/real RVT test are proven.
Before that, returning a clearly unsupported write is CORRECT. Removing
both blanket guards without implementation/host tests could accept unknown
writes, allow cross-session mutations, or return false success.

Near-term implementation order: (1) read-only native Fast Query counts;
(2) candidate `revit_set_parameter` write with explicit target preview
and Transaction test in disposable RVT; (3) create/move/annotation;
(4) destructive delete only with one-shot preview/confirmation token.
MCP/Registry/Jobs/Dynamo/knowledge revisions must not require reinstalling
the native add-in unless host binaries change. MAGS is NEVER a mutation test model.

Exit criteria: full CI + real Revit 2024 host smoke (startup, login, binding,
restore, official manifest and runtime status), then allow user to migrate
preview into official locally. This is not a distributable release yet.
