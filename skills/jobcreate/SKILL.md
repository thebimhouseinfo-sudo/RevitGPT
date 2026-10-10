# Skill: jobcreate
Status: internal

Create or refine repeatable RevitGPT Jobs using the CadGPT Job semantics adapted to RVT authority.

## Job modes
- Reasoning Job: structured `JOB.md`.
- Direct Job: deterministic reviewed `.py` entrypoint.

## Storage
- reusable: `%LOCALAPPDATA%\RevitGPT\libraries\jobs\<library-id>\**`
- drafts: `%LOCALAPPDATA%\RevitGPT\workspace\job-draft\**`
- evidence: `%LOCALAPPDATA%\RevitGPT\data\runs\**`
- registry: `%LOCALAPPDATA%\RevitGPT\registry\user\capabilities.json`
- external folders must be imported/copied into Local AppData. Exported backups are not separate active Job locations. Source `knowledge/jobs/JOB_RULES.md` is reference documentation, not a Custom Job.

## Required lifecycle
`job_draft_new -> author/review -> validate -> real test -> final validation -> Human acceptance -> job_promote_draft`

## Required semantics
Each Job defines goal, preconditions, ordered steps, explicit executor/tool scope, success criteria, failure handling, outputs/postconditions, and final validation.

## Authority
Jobs never inherit an ambient active Revit model. Revit-affecting execution must use the RevitGPT bound-model authority once binding is implemented. Until then, test Jobs only on an explicitly selected/approved model.

Missing evidence stays unresolved. Do not invent a model, element, mapping, family, type, or business rule.
