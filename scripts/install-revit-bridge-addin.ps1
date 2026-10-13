param([int]$RevitYear = 2024, [switch]$PreferPinnedCadAgentBinary)
$ErrorActionPreference = "Stop"
# Old bridge makes unsafe worker-thread Revit API reads and shared-slot writes.
throw "LEGACY_UNSAFE_NATIVE_BRIDGE_BLOCKED: Retired. Use forthcoming unified native RevitGPT installer. No host files were changed."
