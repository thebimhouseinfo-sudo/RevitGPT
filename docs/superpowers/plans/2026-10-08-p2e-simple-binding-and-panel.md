# P2E — Zero-click single-project access and minimal Revit dock

Acceptance from user: P2C Sleep/Wake 5/5 PASS.

- Native auto-binds exactly one UI-open project when previously unbound. Linked documents and Family documents are excluded from the count.
- Closing a bound project never auto-binds another, even when one remains; only Bind Current changes an existing binding.
- All admitted @rg sessions may read only the model explicitly/automatically bound in native host. The current model must equal the bound model. Every read rechecks live native status; writes stay denied in Node and HTTP 501 native.
- Manual Pair and manual lease steps, browser pairing code and local Pair endpoints removed. No conversation-ID-to-MCP-session assumption.
- Header contains only bound project name, Bind Current, Light/Dark toggle; bound-other-active orange, closed yellow, normal follows theme. WebView2 ZoomFactor 0.8 and PreferredColorScheme; ChatGPT account settings can override preferred scheme.
- Retain automatic native bridge backoff/recovery after sleep/wake, without refresh button.

Required real host QA: one project first-open auto-read, multiple-project explicit switch, warning colors, closed model fail-closed, 80% zoom and theme, Sleep/Wake. No model writes.
