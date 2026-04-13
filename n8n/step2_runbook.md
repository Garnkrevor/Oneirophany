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
| `ONEIROPHANY_PACK_PATH` | Yes | `/data/story_foundation_pack.json` | Path to the canonical pack JSON. Read and written by the workflow. |
| `ONEIROPHANY_TEMPLATE_PATH` | Yes | `/data/story_foundation_pack.template.json` | Path to the blank template. Used when no pack exists yet. |
| `ONEIROPHANY_LOG_PATH` | No | `/data/rounds/round_{version}.json` | Path pattern for round log files. `{version}` is replaced with the pack version number at runtime. |
| `ONEIROPHANY_NEXT_Q_PATH` | No | `/data/next_questions.json` | Path for the next questions artifact. Overwritten each round. |
| `ONEIROPHANY_ERROR_PATH` | No | `/data/errors` | Directory for error log files. Created automatically if missing. |

**For development:** Set `ONEIROPHANY_PACK_PATH` to a local path like `/tmp/oneirophany/story_foundation_pack.json`.

**For cloud n8n:** The file system nodes will not work. Replace `Load Current Pack` and `Save Outputs` Code nodes with Google Drive or S3 nodes. The merge logic (node 11, Merge Patches) does not need to change.

---

## Webhook payload contract

The workflow expects a `POST` request to the webhook URL with a JSON body.

**Endpoint path:** `/webhook/foundation-processor`

**Required fields:**

```json
{
  "raw_input": "string — the full text to process (chat transcript, voice transcript, notes, etc.)",
  "round_label": "string — human-readable label e.g. 'Pass 1 - Concept and premise'",
  "input_type": "chat_transcript | voice_transcript | freeform_notes | answer_block"
}
```

**Guardrails applied by Validate Input (node 2):**

- `raw_input` empty or missing → workflow halts with a validation error before any AI call
- `round_label` missing → defaults to `"Unlabeled round"` (does not halt)
- `input_type` not in allowed values → defaults to `"freeform_notes"` (does not halt)

**Example valid request:**

```bash
curl -X POST https://your-n8n-instance/webhook/foundation-processor \
  -H "Content-Type: application/json" \
  -d '{
    "raw_input": "It is definitely dark fantasy. The story is about a disgraced knight...",
    "round_label": "Pass 1 - Concept and premise",
    "input_type": "chat_transcript"
  }'
```

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

## Storage rules

| File | Behavior |
|------|---------|
| `story_foundation_pack.json` | **Read** at start of every run. **Written only on success** (after Merge Patches). Never written on error path. |
| `rounds/round_{version}.json` | New file created each run. Append-only log of round results. |
| `next_questions.json` | Overwritten each run. Ephemeral artifact — the last round's questions. |
| `errors/error_{timestamp}.json` | Created only on error path. Contains raw AI response and error message. |

**Non-negotiable:** The JSON file is the canonical master. Google Docs outputs (if used) are rendered from the JSON, never re-ingested as source.

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

## Replacing file system storage for cloud n8n

The `Load Current Pack` and `Save Outputs` Code nodes use `require('fs')` for local file access. This does not work in n8n cloud.

**Replacement pattern:**

1. Remove the `Load Current Pack` Code node
2. Add a **Google Drive** node to read the pack JSON file
3. Add a **Code node** after it to parse the JSON and pass `current_pack` downstream
4. Remove the file-write lines from `Save Outputs`
5. Add **Google Drive** update nodes at the end for pack, log, and next questions

The `Merge Patches` node does not need to change — it only depends on `{ payload, current_pack }` from `Prepare Merge Input`.

---

## Validation checklist before activating

- [ ] `ANTHROPIC_API_KEY` set and valid
- [ ] `ONEIROPHANY_PACK_PATH` points to a writable location
- [ ] `ONEIROPHANY_TEMPLATE_PATH` points to the template JSON
- [ ] Manual trigger test with fixture 01 data passes (check `ready_for_outline` = false, `version` = 2)
- [ ] Manual trigger test with malformed JSON payload triggers error branch (check error log written, pack NOT updated)
- [ ] Webhook URL recorded and accessible from your interview environment
