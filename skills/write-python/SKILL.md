# Skill: write-python
Status: internal

Author or repair user-owned Python/pyRevit capabilities for RevitGPT.

## Storage
- reusable source: `appdata/libraries/python/<library-id>/**`
- drafts: `appdata/workspace/python-draft/**`
- dynamic temporary variants: `appdata/runtime/dynamic-python/**`
- registry: `appdata/registry/user/capabilities.json`

## Required lifecycle
1. Discover existing registry/library capability before creating a duplicate.
2. Use `python_scaffold` or checkout/create an explicit workspace draft.
3. Edit only the draft, never a permanent managed library with generic file tools.
4. Run `python_validate` for Python syntax.
5. Test against an explicitly approved real RVT/model context when behavior touches Revit.
6. Record runtime evidence under `data/runs`.
7. Promote only after validation and real behavior acceptance using `python_promote_draft`.

## Rules
- Never infer model authority from ActiveView/active UI tab.
- Never silently use an arbitrary open RVT.
- A script is a user capability, not permission to mutate Revit MCP source.
- Revit MCP source changes belong exclusively to the development-only `revit-mcp-dev` skill.
- Preserve explicit document/model identifiers in every Revit-affecting operation.
