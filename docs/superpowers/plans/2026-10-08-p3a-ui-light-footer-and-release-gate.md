# P3A — installed-panel UI release candidate

> **HISTORICAL / SUPERSEDED AS A DEVELOPMENT GATE — 15/10/2026.** Retain evidence and any still-applicable Revit host details only. Current user-level scope is [Product Goal & P1/P2/P3](../../roadmap/PRODUCT_GOAL_AND_PHASE_PLAN.md); see [Change Register](../../roadmap/PLAN_SUPERSESSION_AND_CHANGE_REGISTER.md). Old milestone dependencies, checkpoint/resume, stop/recovery and mandatory test gates below do not govern new implementation. Do not infer current code status from historical plan status.

The existing native package is still marked preview. This change intentionally
does **not** silently replace installed preview with an untested production build.

- Start in Light theme: native header + WebView2 preferred color scheme.
- 80% WebView2 zoom remains unchanged.
- Remove the third bottom RowDefinition: no empty reserved WPF footer.
- Native error/status information floats over the browser area only when needed.
- Light/dark toggle keeps working without navigation/reloading ChatGPT.
- Header warning orange when bound project differs from active, yellow when closed.

Gate for official installer: signed/versioned and unambiguous release package;
rollback; verified Revit 2024 host load; no duplicate manifests; startup pane,
session restore, model switch, color/zoom, offline/sleep recovery; all mutations
remain disabled until independently approved. Do not rename preview installer to
production or deploy to user's host from this source-only commit.
