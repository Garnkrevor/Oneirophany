# Oneirophany

A two-system architecture for developing and writing original fiction: a conversational story architect feeding a controlled editorial production pipeline.

---

## What this is

**Oneirophany** is not a single AI writing tool. It's a structured pipeline with two connected systems:

1. **Story Development System** — A conversational interview process that builds a `story_foundation_pack`, the canonical structured foundation for a book project.
2. **Book Production System** — An n8n workflow that takes that foundation and writes, critiques, and polishes content in controlled stages.

---

## The core principle

> **Do not let the model be the sole keeper of canon.**

The model outputs structured updates. The workflow merges and saves canon. Uncertain ideas stay uncertain until explicitly approved.

---

## Architecture

```
Step 1 — Interview (chat / voice)
    |
    |  raw conversation transcript
    v
Step 2 — Foundation Processor (n8n)
    |
    |  story_foundation_pack.json  (versioned, canonical)
    v
Step 3 — Writing & Polish Pipeline (n8n)
    |
    |  chapter drafts, reviewed and polished in stages
    v
    exported docs
```

### Step 1 — Interview

A chat or voice session driven by the interview system prompt. The prompt behaves like a developmental editor, gathering story information across staged passes without inventing content.

**Passes:**
- Pass 1: Concept and premise
- Pass 2: World foundation
- Pass 3: Protagonist and opposition
- Pass 4: Plot frame
- Pass 5: Ending and payoffs
- Pass 6: Gap analysis

Output: a raw conversation transcript or answer block, pasted into Step 2.

### Step 2 — Foundation Processor

An n8n mini-workflow that converts conversation into structured canon.

**Nodes:**
1. Receive raw round input (webhook / paste)
2. Load current `story_foundation_pack` from storage
3. Normalize raw text (AI node — handles chat, voice, freeform notes)
4. AI extraction — returns `foundation_update_payload` (patches only, not full rewrite)
5. Parse and validate returned JSON
6. Merge patches into pack (Code node — governs canon, not the model)
7. Completeness assessment (optional AI node)
8. Generate next questions (AI node — 5-10 questions max)
9. Save updated pack + summaries to storage

**Key rule:** Google Docs / Drive is output only. The JSON file is the master. Never re-ingest a Google Doc as source of truth.

### Step 3 — Writing & Polish Pipeline

An n8n workflow that uses the approved foundation to generate and refine prose.

**Flow:**
1. Intake
2. Build compressed context pack (foundation + outline + scene info)
3. Generate chapter blueprint / scene brief
4. Human approval gate
5. Layered drafting (one job per node)
6. Critique pass — find issues and create improvement plan only
7. Apply fixes (one pass per issue type)
8. Human review gate
9. Final smoothing
10. Export

**Rules:**
- One job per step. No mega-prompts.
- Critique first, rewrite second.
- Curated context, not full-universe dumps.
- Human approval at blueprint, after first draft, and before final export.
- Each approval/rejection is stored with notes.

---

## Key objects

### `story_foundation_pack`

The canonical structured foundation for the book. See [`schemas/story_foundation_pack.schema.json`](schemas/story_foundation_pack.schema.json).

Confidence levels for individual fields: `confirmed`, `tentative`, `unresolved`, `superseded`.

Includes versioning at the root: `version`, `last_modified`, `changelog`.

### `foundation_update_payload`

The structured output the AI returns each round. A flat list of patches, not a full rewrite. See [`schemas/foundation_update_payload.schema.json`](schemas/foundation_update_payload.schema.json).

---

## File layout

```
schemas/
    story_foundation_pack.schema.json     — JSON Schema definition
    foundation_update_payload.schema.json — patch payload schema
    story_foundation_pack.template.json   — blank starting template

prompts/
    interview_system_prompt.md            — Step 1 interview prompt

n8n/
    step2_processor_notes.md              — Step 2 build guide
    merge_code_node.js                    — Step 2 merge logic (Code node)

docs/
    completeness_criteria.md              — gates for Step 2 -> Step 3 handoff
```

---

## Build order

1. Lock the `story_foundation_pack` V1 schema
2. Lock the `foundation_update_payload` patch format
3. Build Step 2 round processor in n8n
4. Draft the interview system prompt
5. Decide storage layout (JSON master + Google Docs rendered output)
6. Adapt Step 3 writing workflow to use the pack as authority

---

## Division of labor

| Tool | Role |
|------|------|
| Chat / Voice | Discovery, brainstorming, interview |
| n8n | Transcript processing, canon management, file saves, writing pipeline |
| Claude Code | Building the system — schemas, merge logic, prompts, node code |

---

## Storage

- `story_foundation_pack.json` — machine-readable master (n8n reads and writes this)
- Story Foundation summary doc — Google Doc, rendered output only
- World Bible doc — Google Doc, rendered output only
- Character Bible doc — Google Doc, rendered output only
- Plot Spine doc — Google Doc, rendered output only
- Open Questions doc — Google Doc, rendered output only
