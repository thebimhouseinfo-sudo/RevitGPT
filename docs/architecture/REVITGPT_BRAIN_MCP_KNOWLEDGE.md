# RevitGPT Architecture — Brain, Knowledge and Revit MCP

Status: HUMAN architecture correction (2026-10-10). This document is canonical for the three components and supersedes combined planning.

## Responsibility boundaries

    USER
      |
    RevitGPT — THE BRAIN (ChatGPT reasoning/orchestration)
      |--- consults Knowledge in SOURCE CODE
      |       |--- knowledge/revit/   (Revit and Revit API)
      |       |--- knowledge/dynamo/ (Dynamo graph / package)
      |       |--- knowledge/hvac/    (HVAC engineering, MEP)
      |       +--- more fields as needed
      |
      |--- consults Capability Registry (Revit MCP tools / Jobs / Dynamo)
      |
      +--- calls execution subsystems
              |--- Revit MCP -> Native Bridge -> Revit API -> bound RVT
              |--- Job runner (Direct + Reasoning Custom Jobs in Local AppData)
              +--- Dynamo runner (verified .dyn execution in Revit context)

RevitGPT is the brain. It interprets requests, searches and learns from Knowledge, plans actions, selects an appropriate capability, applies professional reasoning, verifies results and reports to the user. It is NOT identical to the Revit MCP package, nor is Revit MCP the reasoning engine.

Knowledge is a library of source-controlled files, with Markdown, text, DOC/DOCX and other suitable document types when a parser/indexer supports them. Canonical material belongs to repository knowledge/ by subject. RevitGPT retrieves it, attributes evidence and applies it to model data; never treat general knowledge as observed model facts.

Revit MCP is a SEPARATE tool component. It provides deterministic typed Revit API reads and writes. It does not own the Knowledge tree, perform HVAC professional reasoning, choose Jobs, teach itself, or store canonical lessons. The Native Bridge alone is permitted to invoke Revit API in Revit's valid UI context, including Transactions.

The Capability Registry is RevitGPT-owned discovery metadata spanning tools, Jobs, Dynamo and other capabilities. It does not grant permissions. A capability is READY only after implementation and applicable validation.

Jobs and Dynamo are separate executable capabilities. **Every Custom Job is either Direct or Reasoning**. Direct Jobs are reviewed deterministic executables (currently Python); Reasoning Jobs use a `JOB.md` workflow planned and executed by the RevitGPT brain. Either kind may coordinate Revit MCP, Dynamo and file-processing operations. Neither Job type is part of the Revit MCP implementation. The WebView2 panel is UI only.

**Custom Job canonical storage: Local AppData only.** On Windows: `%LOCALAPPDATA%\RevitGPT\libraries\jobs\<library-id>\...` for promoted Jobs, `%LOCALAPPDATA%\RevitGPT\workspace\job-draft\...` for drafts, `%LOCALAPPDATA%\RevitGPT\registry\user\` for metadata and `%LOCALAPPDATA%\RevitGPT\data\runs\...` for run evidence. A Job provided through an external directory must be copied/imported into managed Local AppData, not linked there as a live Job. A Job export is a backup, not an alternative canonical installation. Source `knowledge/jobs/JOB_RULES.md` is knowledge about how to make Jobs, never a Custom Job library.

## Knowledge authority and actual implementation gap

- SOURCE knowledge/ is canonical for reviewed Knowledge. AppData knowledge files may be drafts, raw observations and derived search/index caches, but are not a second authoritative knowledge source.
- Current code in src/appdata.mjs seeds some Markdown into AppData; src/managed-tools.mjs searches AppData and knowledge_promote appends there. This is confirmed existing behavior, NOT the target source-of-truth contract.
- Refactor knowledge retrieval to index/retrieve SOURCE knowledge/ (including supported non-Markdown files). Use source path and content hash for citations/index invalidation.
- Send runtime lessons to a proposal/draft workflow. Promote only reviewed, evidence-grounded knowledge into the correct source domain and commit; never silently overwrite reviewed source or private user notes.
- One current misplaced file, knowledge/revit/HVAC_EQUIPMENT_CLASSIFICATION.md, belongs under knowledge/hvac/. Migrate with backward-compatible seed/index changes in an independent implementation task so there is never a confusing pair of authoritative copies.
- Knowledge needs domain, provenance, source revision, supported Revit/Dynamo versions, confidence and review/update date. Project-specific verified rules are distinct from general professional knowledge.

## FCU example: correctly composed responsibilities

RevitGPT consults knowledge/hvac/ for FCU/VRF concepts and any approved project naming rules. It consults Registry to choose Revit MCP equipment query/count and requests current model evidence. Revit MCP returns raw placed-instance counts by Category/Family/Type and selected parameters. RevitGPT analyzes the evidence and determines confirmed/probable/ambiguous classifications. Revit MCP is never expected to independently know whether a vendor indoor unit should count as a project's FCU.

## Governance

Maintain one canonical development branch, leave main stable until release approval, and do not rewrite the working WebView2 UI. This is a documentation-only architecture correction; no runtime semantics, native routes or permissions change automatically.
