# E0 — Chat conversation identity evidence

Source: Human-supplied CadGPT `continuity.ndjson`, analyzed from `request_received` records.

## Observed Chat A

`x-openai-session` fingerprint:

```text
8a9adf2858e46bfe
```

Observed from:

```text
2026-10-02T03:21:51.458Z
through
2026-10-02T17:35:57.862Z
```

Observed span: approximately **14 hours 14 minutes**.

Within that span:

- the `x-openai-session` fingerprint remained the same;
- the `x-openai-subject` fingerprint remained `6b750eea1f57ec9f`;
- at least five distinct MCP transport fingerprints were observed:
  `12b79497188bc823`, `7dbd7905458ce150`, `84b211b42b1c63af`,
  `92fd27c76aaf8945`, `a0eec2c64de692b1`.

This is evidence that the logical conversation identity survived multiple MCP
transport sessions across the observed period.

## Observed Chat B control

A second chat in the same later test window presented:

```text
x-openai-session = f2a737a8dd8adbf0
x-openai-subject = 6b750eea1f57ec9f
```

It used four distinct MCP transport fingerprints while keeping its own
`x-openai-session` stable.

## Decision

For the current product requirement — a **15-minute model lease** — this
evidence is sufficient to promote `x-openai-session` as the RevitGPT
`chat_identity` input.

The implementation must still keep these distinctions:

- `x-openai-session`: chat/conversation identity.
- `x-openai-subject`: user/account-level identity signal, not sufficient to
  distinguish chats.
- `mcp-session-id`: transport identity; it may rotate and must not own an RVT
  model lease.

## Failure/recovery rule

RevitGPT does not require durable recovery of a model lease across
control-plane restart/crash. Human-approved behavior is:

```text
control-plane restart/crash
-> drop leases
-> model becomes FREE
-> next chat performs normal bind
```

Therefore the evidence does not need to prove indefinite persistence of
`x-openai-session`; it only needs to support the 15-minute lease/session
continuity contract under normal operation.
