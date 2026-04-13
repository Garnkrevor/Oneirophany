# Step 2 — Foundation Processor: Build Notes

This document describes how to build the Step 2 n8n workflow. It includes node-by-node guidance, prompt templates, and notes on the harder implementation decisions.

---

## Overview

Step 2 takes raw round input (a pasted chat transcript, voice transcript, or answer block) and produces:
- An updated `story_foundation_pack.json`
- A next-questions doc
- A round summary doc

It is a mini-workflow, not a single node.

---

## Node map

```
[Trigger / Receive Input]
        |
[Load Current Pack]
        |
[Normalize Raw Text]       <-- AI node, not a code transform
        |
[AI Extraction]
        |
[Parse + Validate JSON]
        |
[Merge Patches]            <-- Code node — governs canon
        |
[Compute Completeness]     <-- Part of merge node or separate
        |
[Generate Next Questions]  <-- AI node
        |
[Save Outputs]
```

---

## Node 1 — Trigger / Receive Input

**Type:** Webhook node (or Manual trigger for testing)

**Input payload:**
```json
{
  "raw_input": "...",
  "round_label": "Pass 1 - Concept",
  "input_type": "chat_transcript"
}
```

`input_type` can be: `chat_transcript`, `voice_transcript`, `freeform_notes`, `answer_block`

This field is passed to Node 3 to inform the normalization prompt.

---

## Node 2 — Load Current Pack

**Type:** Read Binary File node (or Google Drive / HTTP Request depending on storage)

Load the current `story_foundation_pack.json` from wherever it lives.

If no pack exists yet (first round), load the blank template from `schemas/story_foundation_pack.template.json`.

Parse the JSON and pass it as an object to downstream nodes.

**Important:** The JSON file is the master. Never load from a Google Doc. Google Docs are output only.

---

## Node 3 — Normalize Raw Text

**Type:** AI node (not a Code node)

This is harder than it looks. The raw input can arrive in very different shapes:

- **Chat transcript:** Contains speaker labels, back-and-forth, tangents, model questions mixed in
- **Voice transcript:** Run-on, repetitive, spoken-language cadence, filler words
- **Freeform notes:** Fragments, half-sentences, unstructured
- **Answer block:** Already structured but may be in any format

A simple code transformation cannot handle all of these reliably. Use an AI node.

**Prompt template:**

```
You are a text normalizer for a story development system.

Your job is to clean the raw input below so it is easier for an extraction model to process.

Rules:
- Keep all story content. Do not remove or summarize story ideas.
- Remove meta-conversation (greetings, technical discussions, "let me rephrase that", etc.)
- Remove filler words and repeated phrases from voice transcripts.
- If there are speaker labels in a chat transcript, keep only the author's messages. Remove assistant messages.
- Preserve the author's own language as much as possible. Do not paraphrase story content.
- Output clean prose or a clean list of statements. Not a summary.

Input type: {{input_type}}

Raw input:
---
{{raw_input}}
---

Normalized output:
```

**Output:** `normalized_text` string, passed to Node 4.

---

## Node 4 — AI Extraction

**Type:** AI node (HTTP Request or built-in AI node)

This node reads the normalized text, compares it against the current pack, and returns a `foundation_update_payload`.

**Prompt template:**

```
You are a structured data extractor for a story development system.

Your job is to read the author's statements from this round and extract updates to the story_foundation_pack as a foundation_update_payload.

Critical rules:
- Only extract information the author actually stated. Do not invent, infer, or embellish.
- Do not infer themes, symbolism, or meaning unless the author explicitly stated them.
- If something is stated clearly and directly, mark status as "confirmed".
- If something is stated with hedging language (maybe, possibly, I think, I'm not sure), mark status as "tentative".
- If the author changes something they previously stated, mark status as "superseded" and include the new value.
- Do not include update records for fields where nothing new was said this round.
- For contradictions: if the new input conflicts with an existing confirmed field in the pack, log it in the contradictions array. Do not auto-resolve it. Do not overwrite the confirmed field.
- For author preferences and constraints (must avoid, must include, style preferences, inspirations), put them in author_notes, not in updates.

Current story_foundation_pack:
---
{{current_pack_json}}
---

Normalized round input:
---
{{normalized_text}}
---

Return a foundation_update_payload JSON object with this structure:
{
  "round_info": {
    "round_label": "string — e.g. Pass 1 - Concept and premise",
    "source_type": "chat|voice|notes|mixed",
    "handoff_date": "YYYY-MM-DD"
  },
  "summary": "string — plain summary of what was learned this round",
  "updates": [
    {
      "section": "project_core|world_foundation|story_engine|character_system|plot_frame|ending_design|author_preferences",
      "field": "string — exact field name from the field reference below",
      "value": "string, array of strings, or null",
      "status": "confirmed|tentative|superseded",
      "source_quote": "string — the author's words that support this",
      "notes": "string — optional model note"
    }
  ],
  "open_questions": [
    {
      "question": "string",
      "section": "string",
      "priority": "high|medium|low",
      "reason": "string — one sentence why this matters"
    }
  ],
  "contradictions": [
    {
      "section": "string",
      "field": "string",
      "earlier_value": "the existing confirmed value",
      "new_value": "the conflicting new value",
      "description": "string",
      "needs_author_resolution": true
    }
  ],
  "author_notes": [
    {
      "type": "must_include|must_avoid|style_preference|constraint|inspiration|nonnegotiable",
      "value": "string",
      "status": "confirmed|tentative"
    }
  ],
  "completeness_hints": {
    "ready_for_outline": false,
    "priority_gaps": ["string — max 5 items"]
  }
}

Field reference by section:
- project_core: title, format, genre_primary, subgenre, premise, hook, audience, market_position
- world_foundation: setting_type, time_period, primary_location, major_world_rules, power_structures, magic_or_power_system, cultures, world_conflicts, secrets
- story_engine: central_conflict, story_question, stakes, themes, hooks, pressure_points, reader_experience
- character_system: protagonist_name, protagonist_role_summary, protagonist_external_goal, protagonist_internal_need, protagonist_wound, protagonist_flaw, protagonist_arc_direction, protagonist_voice_notes, antagonist_name, antagonist_nature, antagonist_role_summary, antagonist_motivation, antagonist_relationship_to_protagonist, relationship_map, factions
- plot_frame: beginning_state, inciting_incident, first_turn, midpoint, darkest_moment, climax, resolution_shape, major_reveals, set_pieces
- ending_design: ending_summary, final_image, protagonist_final_state, relationship_end_states, world_state_after, required_payoffs, emotional_ending_feel
- author_preferences: pov_preference, prose_register, chapter_length_target, tense_preference, explicit_inspirations, must_include, must_avoid, content_limits, trope_targets, trope_avoids, favorite_elements, non_negotiables, style_preferences, constraints

Return only valid JSON. No explanation text outside the JSON object.
```

**Output:** Raw JSON string from model.

---

## Node 5 — Parse and Validate JSON

**Type:** Code node

Parse the model's response. Handle common failure modes:

```javascript
const raw = $input.first().json.choices[0].message.content;

// Strip markdown code fences if the model wrapped the JSON
const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

let payload;
try {
  payload = JSON.parse(cleaned);
} catch (e) {
  // If parsing fails, return an error state for the workflow to handle
  return [{
    json: {
      parse_error: true,
      raw_response: raw,
      error_message: e.message
    }
  }];
}

// Basic structural validation
if (!payload.updates || !Array.isArray(payload.updates)) {
  return [{
    json: {
      parse_error: true,
      raw_response: raw,
      error_message: "updates array missing from payload"
    }
  }];
}

return [{ json: payload }];
```

**If parse fails:** Route to an error branch. Do not merge. Notify human for manual review.

---

## Node 6 — Merge Patches (+ Compute Completeness)

**Type:** Code node

This is the most important node in the workflow. It is the canonical source of truth, not the model.

See `n8n/merge_code_node.js` for the full implementation.

Key behaviors:
- Applies `updates` array records in order using section/field mapping
- confirmed overwrites tentative/superseded/unresolved; does not overwrite confirmed (logs contradiction instead)
- tentative only fills blank or tentative fields; never overwrites confirmed
- superseded applies regardless of current status
- Array fields merge new items with existing, deduped
- `author_notes` from payload are mapped into `author_preferences` list fields
- Does not overwrite `locked` sections under any circumstances
- Appends new `open_questions` with generated IDs and `reason` field
- Logs contradictions without auto-resolving them
- Increments `version`, updates `last_modified`, appends to `changelog`
- Computes `completeness_status` using rules from `docs/completeness_criteria.md`

**Output:** Updated `story_foundation_pack` object.

---

## Node 7 — Generate Next Questions

**Type:** AI node

**Prompt template:**

```
You are helping a story development system prepare for the next interview round.

Based on the updated story foundation pack and blocking issues below, generate the 5-10 most important questions to ask the author next.

Prioritize:
1. Fields listed in blocking_issues
2. High-priority open questions
3. Sections that are partial or not_started

Rules:
- Ask open questions only. Do not suggest answers.
- Do not repeat questions already in open_questions unless they are still unresolved.
- Each question should be specific enough to move the story forward, not generic.

Updated pack completeness:
{{completeness_status_json}}

Blocking issues:
{{blocking_issues}}

Current open questions (unresolved):
{{open_questions_unresolved}}

Return a JSON array of objects: { question, section, why }
```

---

## Node 8 — Save Outputs

**Type:** Write Binary File + Google Docs / Sheets nodes

Save three things:

### 1. `story_foundation_pack.json` (master)
Write the updated JSON back to the same file path. This is the machine-readable master. Every round overwrites this file.

### 2. Round summary doc
A human-readable summary of this round. Include:
- Round label and timestamp
- Patches applied (what changed and to what status)
- Contradictions flagged
- New open questions added
- Summary paragraph from the payload
- Next questions

Append to a running round log doc in Google Drive, or create a new doc per round — your choice.

### 3. Next questions doc
A clean list of suggested next questions, formatted for pasting into the next interview session. Can be a Google Doc or just a text artifact.

---

## Error handling

Build an error branch off Node 5 (parse failure). The error branch should:
1. Save the raw model response to a fallback file for manual inspection
2. Send a notification (email, Slack, or n8n notification node)
3. Do NOT update the master pack
4. Halt the workflow

The master pack should never be updated with invalid data.

---

## Storage notes

- JSON master: Google Drive, a fixed file path, overwritten each round
- Round summaries: append to a Google Doc log, or individual files per round
- Next questions: temporary artifact, can be overwritten each round

Never use a Google Doc as input to the workflow. Reading from a Doc and re-processing it risks injecting rendered formatting as story content. The JSON file is always the input source.

---

## Testing checklist

Before using in production:
- [ ] Run with a blank pack and a short chat transcript — verify patches apply correctly
- [ ] Run with a pack that has confirmed fields — verify `skip_if_confirmed` prevents overwrite
- [ ] Run with a transcript that contradicts a confirmed field — verify contradiction is logged, not silently overwritten
- [ ] Run with a voice transcript — verify normalization removes filler without losing story content
- [ ] Force a JSON parse failure — verify error branch fires and master pack is not updated
- [ ] Verify `version` increments, `last_modified` updates, and `changelog` appends correctly each round
