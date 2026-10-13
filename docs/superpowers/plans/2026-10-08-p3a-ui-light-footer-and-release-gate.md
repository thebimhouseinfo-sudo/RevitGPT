# P3A — installed-panel UI release candidate

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
