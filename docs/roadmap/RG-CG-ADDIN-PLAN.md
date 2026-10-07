# RG / CG Add-in Plan

Status: **MIGRATED DESIGN CONTRACT — J-8A2C P0**  
Scope: **RevitGPT (RG) + CadGPT (CG) convenience add-ins**  
Principle: **The add-in automates plumbing; it does not replace the local engine or the ChatGPT plugin.**  
Canonical RevitGPT authority lifecycle: [`../architecture/AUTHORITY_LIFECYCLE.md`](../architecture/AUTHORITY_LIFECYCLE.md)

## 1. Goal

Provide an embedded ChatGPT experience inside Revit and AutoCAD so normal users mostly interact with **commands and jobs**, while workspace discovery, binding, session restoration, and connection plumbing are handled automatically.

The existing browser workflow remains supported.

~~~text
ChatGPT Web
    |
  @rg / @cg
    |
Local RG / CG engine
    |
Revit API / AutoCAD API
~~~

The add-in only adds an embedded UI and automation layer:

~~~text
Host application
    |
Dockable add-in panel
    |
WebView2 -> ChatGPT Web
    |
@rg / @cg
    |
Local RG / CG engine
~~~

## 2. Non-goals

- Do not move model/drawing execution logic into the ChatGPT plugin.
- Do not make WebView2 or the add-in the source of truth for model/drawing authority.
- Do not remove manual commands such as list/bind/status/stop.
- Do not make browser mode depend on the add-in.
- Do not use fragile DOM automation as the core execution path.

## 3. Shared architecture

### 3.1 Responsibilities

**ChatGPT plugin (@rg / @cg)**
- Exposes commands/tools/jobs to ChatGPT.
- Provides the conversation-side gateway.
- Performs admission/handshake with the local runtime.
- Forwards requests and returns results.

**Local RG / CG engine**
- Owns workspace state.
- Owns model/drawing binding.
- Owns capability/lease state.
- Executes Revit/AutoCAD API operations.
- Is the authority for bind/rebind decisions.

**Add-in**
- Hosts ChatGPT Web in a dockable WebView2 panel.
- Uses a persistent WebView2 profile so login/chat state can survive application restart.
- Automates normal workspace discovery/binding/restore steps.
- Displays binding/connection state.
- Provides fast local UI actions such as bind current model.
- Remains optional.

### 3.2 Browser mode remains first-class

All manual commands stay available because a user may choose ChatGPT in a normal browser instead of the embedded panel.

Examples:

~~~text
rg/list
rg/bind
rg/status
rg/stop

cg/list
cg/bind
cg/status
cg/stop
~~~

The add-in may call equivalent operations automatically, but must not create a second incompatible control path.

## 4. RevitGPT add-in

### 4.1 Host UI

Use a Revit DockablePane with WPF + WebView2.

The panel contains:
- Small RG status/header area.
- A startup **Bridge Gate** that covers the chat surface until the Revit bridge is explicitly started and READY.
- Embedded ChatGPT Web, revealed only after the Bridge Gate reaches READY.
- Binding mismatch indication.
- Fast bind action when appropriate.

### 4.2 Primary-model rule

RevitGPT keeps **one primary bound model** for the current workspace/chat.

Other open Revit documents may be references, linked/temporary documents, families, or other projects, but they do not automatically replace the primary binding.

~~~text
RG workspace
    |
    +-- primary model  <--- authority target
    |
    +-- other open documents (secondary/reference)
~~~

Switching active Revit views/tabs must **not** automatically change the bound model.

### 4.3 Startup / restore flow

The Revit add-in uses an explicit **Bridge Gate** before exposing ChatGPT.

On panel startup, the WebView/chat surface remains mounted behind the gate but is fully covered and not user-interactive. The user must explicitly press **Start Bridge**.

~~~text
Revit starts
    |
open RG dockable panel
    |
BRIDGE GATE covers the chat surface
    |
[ Start Bridge ]
    |
STARTING
    |
bridge health 127.0.0.1:8765 == READY
    |
remove Bridge Gate
    |
show/restore ChatGPT WebView
    |
restore/create workspace + primary binding
    |
@rg handshake
    |
READY
~~~

Required gate behavior:

- Before the click: show only the RevitGPT shell/header and a dominant **Start Bridge** action; chat must not be usable.
- While starting: disable repeat clicks and show `STARTING`.
- On success: transition to `BRIDGE READY`, remove the blocking overlay, then expose the WebView and perform the `@rg` handshake.
- On failure: keep the blocking overlay in place and change the action to **Retry Start Bridge**; show a concise bridge error/diagnostic state.
- The gate controls bridge readiness only. It must not create model authority, perform model rebinding, or manufacture ChatGPT activity.
- If bridge connectivity is lost after READY, preserve the WebView/conversation instance behind the overlay and re-show the Bridge Gate for recovery instead of destroying the chat session.

Normal users should not need to know that pyRevit is the underlying bridge runtime, nor perform list -> select -> bind manually.

### 4.4 Binding mismatch UX

Track the active Revit document/view.

If active model equals bound model, show normal/ready state.

If active model differs from bound model, do **not** rebind automatically. Instead:
- Change the panel border/header to a clear mismatch color.
- Show both:
  - Bound: Project-A.rvt
  - Viewing: Project-B.rvt
- Expose a fast action:
  - **Lease + Bind Current**

Suggested states:

~~~text
READY        -> normal/subtle positive indicator
MISMATCH     -> warning/orange indicator
BROKEN       -> red/error indicator
~~~

The visual state reflects binding; it does not determine binding.

### 4.5 Lease + Bind Current

The button is an explicit user action.

Internal flow:

~~~text
current active model
    |
request/acquire local capability lease
    |
set workspace primary model
    |
persist binding metadata
    |
refresh/re-handshake @rg if needed
    |
READY
~~~

On failure, preserve the previous valid binding. Never leave a half-switched workspace.

### 4.6 Revit tab normalization utility

Because multiple Revit projects can have interleaved view tabs, provide an optional normalization action/workflow:

- Keep one representative UI view tab per open model/project.
- Close extra UI view windows only.
- Never delete Revit View/Sheet elements.
- Keep the bound model's representative view as the visual anchor.

Purpose: reduce user confusion about which project is currently being viewed.

## 5. CadGPT add-in

### 5.1 Host UI

Use an AutoCAD dockable palette/panel with WebView2.

Same shared shell goals:
- Persistent ChatGPT login/profile.
- Restore conversation.
- Auto @cg handshake.
- Show workspace/drawing status.
- Keep browser mode fully usable.

### 5.2 Current workspace policy

Initial add-in policy remains:

~~~text
1 main CG workspace
    |
1 main bound drawing
~~~

Other open DWGs may be temporary/reference/source drawings.

CadGPT already binds to the selected drawing independently of which AutoCAD tab is currently active; the add-in must preserve that behavior.

### 5.3 Future multi-drawing evolution

Do **not** require one-chat-per-drawing in the first add-in implementation.

Keep the architecture open for a later evidence-driven mode:

~~~text
Drawing A -> Chat A -> Workspace A
Drawing B -> Chat B -> Workspace B
Drawing C -> Chat C -> Workspace C
~~~

Only implement this after real usage validates that it improves the workflow.

### 5.4 Capability-handle direction

For future CG multi-workspace support, investigate the GPTWorker-style pattern:

~~~text
workspace/work handle
    |
capability binding ID
    |
shared CAD capability implementation
    |
AutoCAD API
~~~

Prefer lending/assigning a **capability ID/handle** to a workspace rather than lending an entire tool/toolset instance.

Tools remain operations on a capability; GPT should not need to carry drawing IDs through every tool call.

## 6. Conversation and runtime lifecycle

Separate persistent binding from disposable runtime transport.

Conceptually:

~~~text
Host document/model
    <->
Workspace
    <->
ChatGPT conversation
~~~

is a durable binding, while plugin transport / MCP connection / runtime session may reconnect or be replaced.

A runtime reconnect must not by itself destroy the host-document/conversation association.

### Add-in managed conversation

The add-in should restore/open the known conversation and use @rg/@cg handshake to confirm the live conversation path.

RevitGPT uses two explicit authority modes defined by the canonical lifecycle contract:

~~~text
BROWSER_TTL
  ordinary browser/plugin chat
  15-minute idle lease

ADDIN_MANAGED
  WebView chat successfully paired to the add-in
  no RevitGPT idle timeout while pair remains valid
~~~

The add-in must not use a synthetic heartbeat merely to manufacture activity. Windows sleep, WebView recreation, panel hide/show, and MCP transport replacement are not session-end signals for `ADDIN_MANAGED`.

The pair is established by local pair-window handshake + normal `@rg` admission. WebView cookies, DOM state, login state, and transport identity never grant model authority.

All release/recovery semantics are owned by the canonical contract in `docs/architecture/AUTHORITY_LIFECYCLE.md`.

## 7. WebView2 rules

- Use a dedicated persistent user-data/profile folder per product.
- Treat ChatGPT as a top-level WebView2 page, not an iframe.
- Do not scrape authentication tokens/cookies.
- Avoid DOM selectors as a hard dependency.
- If automatic @rg/@cg invocation requires UI automation, isolate it behind a replaceable adapter and keep the core architecture independent of it.
- Local RG/CG state remains valid even if the WebView crashes/reloads.

## 8. User experience target

### Browser mode

Power/manual workflow remains available:

~~~text
open ChatGPT in browser
    |
@rg / @cg
    |
list / bind / status / jobs / commands
~~~

### Add-in mode

Normal workflow:

~~~text
open Revit/AutoCAD
    |
open model/drawing
    |
workspace + binding handled in background
    |
embedded ChatGPT restored
    |
handshake ready
    |
user uses commands/jobs
~~~

User should mainly need to remember:
- Commands
- Jobs
- Domain actions

User should normally not need to remember:
- Workspace discovery
- Candidate listing
- Lease plumbing
- Bind/reconnect sequence
- Runtime transport details

## 9. MVP implementation phases

### A1 - Shared embedded shell
- WebView2 host.
- Persistent profile.
- Basic status header.
- A blocking startup gate surface that can cover the WebView without destroying/recreating it.
- Open/restore ChatGPT Web only after the host-specific readiness gate is satisfied.
- Clean shutdown/restart behavior.

### A2 - Revit integration
- DockablePane.
- **Bridge Gate** with explicit Start Bridge / STARTING / READY / ERROR states.
- Start/restart bridge action owned by the RevitGPT panel header; pyRevit remains an implementation detail.
- Do not expose the WebView/chat to the user before bridge READY.
- On bridge loss after READY, re-cover the existing WebView rather than recreating the conversation.
- Local workspace/model status binding.
- Active-vs-bound model detection.
- READY/MISMATCH/BROKEN indicator.
- Lease + Bind Current.
- Optional one-tab-per-model normalization.

### A3 - Cad integration
- AutoCAD palette/panel.
- Restore main CG workspace/drawing state.
- Embedded ChatGPT + @cg handshake.
- Confirm active-tab switching does not alter bound drawing.

### A4 - Conversation restore + handshake
- Persist conversation association.
- Restore the intended conversation.
- Validate reconnect/re-handshake without losing local binding.
- Validate BROWSER_TTL vs ADDIN_MANAGED behavior against the canonical lifecycle contract.
- Isolate any UI-trigger automation from core binding logic.

### A5 - Hardening
- Revit/AutoCAD restart.
- Machine restart.
- ChatGPT logout/relogin.
- WebView crash/reload.
- Plugin/MCP reconnect.
- Idle > browser TTL with add-in pair still valid.
- Windows sleep/resume.
- Host model/drawing closed.
- Wrong model visually active.
- Bind-current failure rollback.

## 10. Acceptance tests

### Shared
- Browser mode still works with no add-in.
- Add-in can be closed without breaking the local engine.
- Restart preserves the expected ChatGPT profile/login where supported.
- Runtime reconnect does not silently change the bound host document.

### Revit
- On panel startup, ChatGPT is fully blocked by the Bridge Gate until the user presses Start Bridge and bridge health reaches READY.
- `@rg` is not invoked before Bridge READY.
- A failed bridge start leaves the gate in place and exposes Retry Start Bridge without destroying the WebView profile/conversation.
- If bridge connectivity is lost after READY, the gate returns over the existing WebView while preserving the conversation instance.
- One primary model remains authoritative.
- Switching to another project's view changes the panel to MISMATCH but does not rebind.
- Lease + Bind Current explicitly moves authority to the current model.
- Failed bind preserves the previous model.
- UI-tab normalization leaves one representative tab per open model and deletes no Revit views.

### Cad
- Main bound drawing remains authoritative when the user clicks another DWG tab.
- Reference/temporary drawings remain usable without becoming main workspace.
- Add-in does not require multi-drawing/multi-chat support for MVP.

## 11. Core design rule

> **Commands/plugins define the ChatGPT-facing interface. Local RG/CG code owns authority and execution. The add-in only makes the plumbing invisible.**
