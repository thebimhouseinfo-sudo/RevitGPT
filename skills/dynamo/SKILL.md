# Skill: dynamo
Status: internal

Manage user-owned Dynamo `.dyn` capabilities without treating them as internal RevitGPT source.

## Storage
- reusable: `appdata/libraries/dynamo/<library-id>/**`
- drafts: `appdata/workspace/dynamo-draft/**`
- registry: User Registry via `dynamo_register`

## Rules
- Dynamo files are user assets.
- Never overwrite an external source folder silently.
- Import/copy into managed AppData before RevitGPT owns lifecycle.
- Execute only under explicit model authority.
- Record test evidence before promoting/reusing a workflow.
