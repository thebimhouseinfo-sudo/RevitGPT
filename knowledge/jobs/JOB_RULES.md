# RevitGPT Job Rules

A Job is a repeatable Revit workflow with explicit goal, steps, authority, evidence, and final validation.

## Job vs Skill vs Tool
- Job: repeatable workflow.
- Skill: reusable expert authoring/development capability.
- Tool: concrete execution mechanism.

## Modes
- **Reasoning Job**: a reviewed `JOB.md` with goal, decisions, steps, dependencies and validation. The RevitGPT brain interprets and orchestrates it by selecting registered capabilities.
- **Direct Job**: deterministic reviewed executable (currently Python `.py`). It must use a permitted runner and return structured execution evidence.
- Both use the same managed Job Registry. Merely discovering or drafting a file never grants permission to execute it.

## Storage: Local AppData is the ONLY Custom Job authority
- Reusable Custom Jobs: `%LOCALAPPDATA%\RevitGPT\libraries\jobs\<library-id>\**`.
- Drafts: `%LOCALAPPDATA%\RevitGPT\workspace\job-draft\**`.
- Runtime evidence and checkpoints: `%LOCALAPPDATA%\RevitGPT\data\runs\**`.
- Registry: `%LOCALAPPDATA%\RevitGPT\registry\user\capabilities.json`.
- External folders may be **import sources** but may NOT be live registered Job locations. Import the Job to Local AppData first.
- This source file `knowledge/jobs/JOB_RULES.md` defines authoring rules; it is NOT itself a Custom Job.

## Authority
A Job must not infer target RVT from ActiveView or UI focus. Once lease/binding is implemented, every Revit-affecting step verifies the current bound model. Before then, real tests require explicit Human model selection.

## Validation
Dispatch is not success. Every Job defines final validation against actual model/result. Missing evidence means unresolved/fail, not guessed success.
