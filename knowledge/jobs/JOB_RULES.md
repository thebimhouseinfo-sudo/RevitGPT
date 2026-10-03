# RevitGPT Job Rules

A Job is a repeatable Revit workflow with explicit goal, steps, authority, evidence, and final validation.

## Job vs Skill vs Tool
- Job: repeatable workflow.
- Skill: reusable expert authoring/development capability.
- Tool: concrete execution mechanism.

## Modes
- Reasoning Job: `JOB.md`.
- Direct Job: deterministic reviewed Python.

## Storage
Reusable Jobs live in `appdata/libraries/jobs/<library-id>/**`.
Drafts live in `appdata/workspace/job-draft/**`.
Runtime evidence lives in `appdata/data/runs/**`.

## Authority
A Job must not infer target RVT from ActiveView or UI focus. Once lease/binding is implemented, every Revit-affecting step verifies the current bound model. Before then, real tests require explicit Human model selection.

## Validation
Dispatch is not success. Every Job defines final validation against actual model/result. Missing evidence means unresolved/fail, not guessed success.
