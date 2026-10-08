# HVAC equipment classification — FCU versus indoor units

Status: **curated general guidance, NOT verified facts about any particular RVT**.

## Counting actual equipment
- Count placed `FamilyInstance` records, not loaded Family definitions or Type symbols.
- First query `revit_list_elements` with `category="Mechanical Equipment"` and `class_name="FamilyInstance"`. Confirm the category uses the project's localized names. Use a broader query if the project category differs.
- Group instances by exact Family and Type; inspect relevant shared parameters (equipment type, equipment mark, system, tag, manufacturer, model) if exposed.
- Family name `FCU` is strong candidate evidence, not infallible.
- Mitsubishi PEFY models can represent ducted indoor units in VRF/VRV systems; they may fulfill a fan-coil-like indoor unit role, but **must not automatically be classified as hydronic FCUs**.
- A unit's classification requires the project's naming conventions, system/connection and parameter evidence. If unresolved, report *certain FCU instances*, *possible FCU/indoor units*, and *unresolved* separately.
- Avoid interpreting `0 Family name contains FCU` as `0 actual FCU devices` without other evidence.
- Do not aggregate instances from linked projects into the host model total unless the user explicitly requests links.

## Example answer format
`Confirmed FCU: N; probable FCU/indoor units: M (Family A, Type B); unresolved: K. Exact total not yet established without classification rules.`

## Workflow selection
For single-count questions, prefer one bulk Mechanical Equipment inventory over repeated type-by-type calls. Future reviewed `revit_summarize_equipment` tool can aggregate within native Revit on one ExternalEvent call; do not advertise that tool as installed until it exists and is host-tested.

## Provenance
This is reusable HVAC/Revit working guidance. For a specific project, classify based only on read evidence from that model, and ask the user to resolve ambiguities instead of guessing.
