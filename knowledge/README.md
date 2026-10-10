# RevitGPT Knowledge — source of truth

Knowledge is SOURCE-CONTROLLED reference material for the RevitGPT brain,
not part of the Revit MCP tool subsystem.

Domains:
- revit/ — Revit concepts, API behavior, modelling workflow and version caveats
- dynamo/ — Dynamo graph, nodes, packages, interoperability and best practices
- hvac/ — HVAC/MEP equipment, systems, classification, conventions, calculations

More disciplines may be added. Knowledge can include MD, TXT, DOC/DOCX and
other reference files where a supported extraction/indexing pipeline exists.
Original documents remain sources; any extracted text/embeddings/indexes
are derived and must be invalidated when source hashes change.

Run-time observations and lessons can be drafted in AppData. Reviewed stable
learning should be promoted to the appropriate SOURCE knowledge/domain file
through a versioned change. Current AppData seeding, searching and promotion
code is legacy to refactor; it must not become a competing source of truth.

Canonical boundary: docs/architecture/REVITGPT_BRAIN_MCP_KNOWLEDGE.md
