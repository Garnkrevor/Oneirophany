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

Your job is to read the author's statements from this round and extract updates to the story foundation pack.

Critical rules:
- Only extract information the author actually stated. Do not invent, infer, or embellish.
- If something is stated clearly and directly, mark status as "confirmed".
- If something is stated with hedging language (maybe, possibly, I think, I'm not sure), mark status as "tentative".
- If the author explicitly says they don't know something, mark status as "unresolved".
- If the author changes something they previously said, mark the patch with status "superseded" and include the new value.
- Do not include patches for fields where nothing new was said.
- For contradictions: if the new input conflicts with an existing confirmed field, log it in the contradictions array. Do not auto-resolve it.
- extraction_confidence should reflect how clearly expressed the source material was overall.

Current story_foundation_pack:
---
{{current_pack_json}}
---

Normalized round input:
---
{{normalized_text}}
---

Return a foundation_update_payload JSON object matching this schema:
- patches: array of { path, value, status, notes?, merge_rule? }
- open_questions: array of { question, section, priority }
- contradictions: array of { path, existing_value, new_value, description }
- summary: string
- suggested_next_questions: array of { question, section, why } (max 10)
- extraction_confidence: "high" | "medium" | "low"

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
if (!payload.patches || !Array.isArray(payload.patches)) {
  return [{
    json: {
      parse_error: true,
      raw_response: raw,
      error_message: "patches array missing from payload"
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
- Applies patches in order
- Respects `merge_rule` per patch (default: `skip_if_confirmed`)
- Does not overwrite `locked` sections under any circumstances
- Appends new `open_questions` with generated IDs
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
