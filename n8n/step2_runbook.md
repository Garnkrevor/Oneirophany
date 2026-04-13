# Step 2 Foundation Processor — Runbook

This document covers everything needed to deploy, operate, and debug the Step 2 n8n workflow.

---

## Workflow file

| File | Purpose |
|------|---------|
| `n8n/build_workflow.js` | Source of truth. Generates the workflow JSON. |
| `n8n/step2_workflow.json` | Generated artifact. Import this into n8n. |
| `n8n/merge_code_node.js` | Merge logic source. Inlined by build script into node 11. |

**Never edit `step2_workflow.json` directly.** Edit the source files and re-run the build script:

```bash
node n8n/build_workflow.js
```

---

## Import into n8n

1. Open n8n
2. Settings > Import Workflow
3. Select `n8n/step2_workflow.json`
4. Set environment variables (see below)
5. Test with Manual Trigger before activating Webhook

---

## Environment variables

Set these in n8n's environment or in the `.env` file for your n8n instance.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key. Used in all three AI HTTP Request nodes. |

**Note:** This workflow is fully cloud-compatible. It does not use the filesystem. The `current_pack` is sent in the webhook payload and the `updated_pack` is returned in the response. The caller manages storage (Google Drive, database, etc.).

---

## Webhook payload contract

The workflow expects a `POST` request to the webhook URL with a JSON body.

**Endpoint path:** `/webhook/foundation-processor`

**Required fields:**

```json
{
  "raw_input": "string — the full text to process (chat transcript, voice transcript, notes, etc.)",
  "round_label": "string — human-readable label e.g. 'Pass 1 - Concept and premise'",
  "input_type": "chat_transcript | voice_transcript | freeform_notes | answer_block",
  "current_pack": "object — the story_foundation_pack JSON. On round 1, send the template. On subsequent rounds, send the updated_pack from the previous response."
}
```

**Guardrails applied by Validate Input (node 2):**

- `raw_input` empty or missing → workflow halts with a validation error before any AI call
- `round_label` missing → defaults to `"Unlabeled round"` (does not halt)
- `input_type` not in allowed values → defaults to `"freeform_notes"` (does not halt)

**Example valid request (round 1 — send template as current_pack):**

```bash
curl -X POST https://your-n8n-instance/webhook/foundation-processor \
  -H "Content-Type: application/json" \
  -d '{
    "raw_input": "It is definitely dark fantasy. The story is about a disgraced knight...",
    "round_label": "Pass 1 - Concept and premise",
    "input_type": "chat_transcript",
    "current_pack": { ... template JSON ... }
  }'
```

**Response on success:**

```json
{
  "success": true,
  "version": 2,
  "round_summary": "...",
  "ready_for_outline": false,
  "ready_for_drafting": false,
  "blocking_issues": ["..."],
  "next_questions": [{"question": "...", "section": "...", "why": "..."}],
  "merge_report": {...},
  "updated_pack": { ... the updated story_foundation_pack ... },
  "round_log": { ... round log record ... }
}
```

Save `updated_pack` and send it as `current_pack` in the next round.

---

## Node map

```
Webhook
  └─ Validate Input (Code)
       └─ Load Current Pack (Code)
            └─ Build Normalize Request (Code)
                 └─ AI: Normalize Text (HTTP → Anthropic)
                      └─ Build Extract Request (Code)
                           └─ AI: Extract Payload (HTTP → Anthropic)
                                └─ Parse and Validate (Code)
                                     └─ IF: Parse Error
                                          ├─ [true]  Error Handler (Code)  ← HALT
                                          └─ [false] Prepare Merge Input (Code)
                                                       └─ Merge Patches (Code)
                                                            └─ Build Next Questions Request (Code)
                                                                 └─ AI: Next Questions (HTTP → Anthropic)
                                                                      └─ Save Outputs (Code)
```

---

## Storage rules (cloud-compatible)

This workflow does not read or write files. All state flows through the webhook request/response cycle:

| Data | Where it lives | Behavior |
|------|----------------|----------|
| `story_foundation_pack` | Caller's storage (Google Drive, DB, etc.) | Sent as `current_pack` in request. Returned as `updated_pack` in response. Caller saves it. |
| Round log | Response payload | Returned as `round_log` in the response. Caller stores it as desired. |
| Next questions | Response payload | Returned as `next_questions` in the response. |
| Error details | Response payload | On error, `error_record` contains the raw AI response and error message. |

**Non-negotiable:** The JSON pack is the canonical master. Google Docs outputs (if used) are rendered from the JSON, never re-ingested as source.

---

## Failure branch behavior

The workflow has one explicit error branch, reached when `IF: Parse Error` evaluates `parse_error = true`.

**Causes that trigger the error branch:**

1. AI returned malformed JSON (not parseable)
2. AI returned JSON without a valid `updates` array
3. AI returned JSON without a `round_info` object
4. Any `updates` item is missing `section` or `field`
5. Any `updates` item has an invalid `status` value

**What the error branch does:**

1. Saves the raw AI response to `ONEIROPHANY_ERROR_PATH/error_{timestamp}.json`
2. Returns a `halted: true` response with the error message
3. Does **not** update the master pack
4. Does **not** write a round log

**Recovery:** Inspect the error file. The raw AI response will show what the model returned. Common causes: model returned explanation text before the JSON, model used wrong key names (e.g., `patches` instead of `updates`), model returned partial JSON truncated by token limit. Increase `max_tokens` on node 7 if truncation is suspected.

---

## Inspecting merge_report

The `Merge Patches` node (node 11) outputs a `merge_report` object visible in n8n's execution log and passed through to `Save Outputs`.

**Key fields:**

| Field | Meaning |
|-------|---------|
| `version` | New pack version number after this merge |
| `updates_applied` | Number of field updates successfully written |
| `updates_skipped` | Updates skipped (confirmed field protection, locked section, etc.) |
| `contradictions_logged` | Number of contradictions detected — these require human review |
| `new_open_questions` | Open questions added this round |
| `author_notes_applied` | Author preference notes merged into author_preferences |
| `ready_for_outline` | Boolean — pack meets outline readiness criteria |
| `ready_for_drafting` | Boolean — pack meets drafting readiness criteria |
| `blocking_issues` | Array of plain-language descriptions of what's blocking advancement |
| `skipped` | Detailed list of skipped updates with reasons |
| `contradictions` | Full contradiction records including source (payload or merge_guard) |

To inspect during development: open the execution in n8n, click node 11 (Merge Patches), view Output.

---

## Development mode

For local development without a running webhook:

1. Import the workflow into n8n
2. Switch node 1 from **Webhook** to **Manual Trigger** (edit the node type)
3. Pin test data to Validate Input using n8n's "Pin Data" feature
4. Use fixture data from `tests/fixtures/` as the pinned input for Merge Patches

Alternatively, use the test harness directly:

```bash
node tests/run_merge_tests.js
```

This runs the merge logic against all fixtures without n8n. All 5 fixtures should pass before deployment.

---

## Rebuilding the workflow JSON

Whenever you change `merge_code_node.js` or any Code node content in `build_workflow.js`:

```bash
node n8n/build_workflow.js
# Then re-import step2_workflow.json into n8n
```

The build script is the source of truth for the workflow structure. The generated JSON is a build artifact.

---

## Cloud compatibility

This workflow is fully cloud-compatible out of the box. No filesystem access is used.

- `current_pack` is sent by the caller in the webhook POST body
- `updated_pack` is returned in the webhook response
- The caller is responsible for persisting the pack between rounds (e.g., in Google Drive, a database, or local storage)

This design works on Hostinger n8n, n8n cloud, self-hosted n8n, or any n8n instance.

---

## Validation checklist before activating

- [ ] `ANTHROPIC_API_KEY` environment variable set and valid in n8n
- [ ] Manual trigger test with fixture 01 data + template pack as `current_pack` passes
- [ ] Verify response includes `updated_pack` with `version: 2`
- [ ] Manual trigger test with malformed JSON triggers error branch (response has `halted: true`, no `updated_pack`)
- [ ] Webhook URL recorded and accessible from your interview environment
