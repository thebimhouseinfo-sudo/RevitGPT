# x-openai-session stability test

## Purpose

Establish how long the connector-provided `x-openai-session` identity remains stable inside **one ChatGPT conversation** before RevitGPT uses it for:

- lease refresh on every message in the same conversation;
- same-chat reconnect after an idle period;
- separation between one ChatGPT conversation and another.

This test is intentionally **independent of Revit**.

## Reference basis

CadGPT already has production continuity diagnostics that:

- fingerprints `x-openai-session`;
- fingerprints `x-openai-subject`;
- fingerprints `mcp-session-id` separately;
- records a `runtime_id` and timestamp;
- previously showed the same `x-openai-session` across replacement MCP transports in a short test.

This RevitGPT test does not invent a new identity mechanism. It extends that existing observation to longer durations.

## Important limitation

CadGPT continuity fingerprints are salted per CadGPT runtime. **Do not restart CadGPT during the 8-hour test.**

If CadGPT restarts, the analyzer reports `UNCOMPARABLE_RUNTIME_RESTART`; those rows cannot prove whether the raw header changed.

Revit is not required. AutoCAD does not need to be open.

## Test procedure

Use **one ChatGPT conversation** for the main timeline.

### Start

1. Ensure CadGPT/CG slim control plane is running.
2. From this repository run:

   ```bat
   session-test.bat reset
   ```

3. In the ChatGPT conversation being tested, invoke **CG/CadGPT** once with a lightweight command such as `cg/status`.
4. Immediately run:

   ```bat
   session-test.bat capture t0
   ```

### 1-hour checkpoint

In the **same ChatGPT conversation**:

1. invoke CG again with `cg/status`;
2. run:

   ```bat
   session-test.bat capture 1h
   ```

### 4-hour checkpoint

Repeat in the same conversation:

```bat
session-test.bat capture 4h
```

### 8-hour checkpoint

Repeat in the same conversation:

```bat
session-test.bat capture 8h
```

### Different-chat control

At any convenient point while the same CadGPT runtime is still running:

1. open a **different ChatGPT conversation**;
2. invoke CG/CadGPT there;
3. run:

   ```bat
   session-test.bat capture control-new-chat
   ```

The control should have a different `x-openai-session` fingerprint. `x-openai-subject` is expected to remain account/user-scoped based on the prior CadGPT observation, but this test records rather than assumes that result.

## Report

Run:

```bat
session-test.bat report
```

The report compares every checkpoint against `t0`.

Desired evidence:

- `t0`, `1h`, `4h`, `8h` => `SAME_CHAT_ID`;
- `control-new-chat` => `DIFFERENT_CHAT_ID`;
- transport fingerprint is allowed to rotate while the logical `x-openai-session` fingerprint remains stable.

## Evidence location

Captured checkpoints are stored at:

```text
%LOCALAPPDATA%\RevitGPT\session-probe\checkpoints.ndjson
```

CadGPT source evidence remains at:

```text
%LOCALAPPDATA%\CadGPT\logs\continuity.ndjson
```

No raw OpenAI identity header is copied into RevitGPT evidence; only CadGPT's existing fingerprints are recorded.

## Decision gate

Do not promote `x-openai-session` to RevitGPT's long-lived `chat_identity` contract until this test is complete.

- Stable through 8h + different-chat control behaves correctly -> strong evidence to use it.
- Stable only through a shorter checkpoint -> use only within proven duration or collect more evidence.
- Changes unexpectedly in the same chat -> do not use it as sole reconnect/lease-refresh identity.
- Runtime restart during test -> rerun; result is inconclusive because fingerprints are not comparable across CadGPT runtimes.
