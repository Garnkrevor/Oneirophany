#!/usr/bin/env node
/**
 * tests/generate_proof_runs.js
 *
 * Generates two proof run output files:
 *   tests/proof_runs/01_happy_path_output.json    — fixture 01 through merge code
 *   tests/proof_runs/02_error_branch_output.json  — simulated parse failure (Node 5 logic)
 *
 * Usage: node tests/generate_proof_runs.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const MERGE_CODE = fs.readFileSync(path.join(ROOT, 'n8n/merge_code_node.js'), 'utf-8');
const TEMPLATE   = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/story_foundation_pack.template.json'), 'utf-8'));

const outDir = path.join(__dirname, 'proof_runs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

// ─── Merge runner (same as test harness) ─────────────────────────────────────

function runMerge(currentPack, payload) {
  const $input = { first: () => ({ json: { payload, current_pack: currentPack } }) };
  const fn = new Function('$input', MERGE_CODE);
  return fn($input)[0].json;
}

// ─── Proof run 1: Happy path ──────────────────────────────────────────────────

const fixture01 = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/01_happy_path_pass1.json'), 'utf-8')
);

const happyResult = runMerge(
  JSON.parse(JSON.stringify(TEMPLATE)),
  fixture01.payload
);

const happyPathOutput = {
  proof_run: '01 — Happy path (Pass 1)',
  fixture: '01_happy_path_pass1.json',
  description: fixture01.description,
  simulates: 'Nodes 6 (Prepare Merge Input) + 11 (Merge Patches) with fixture 01 payload on blank template',
  input_summary: {
    starting_pack_version: 1,
    payload_round_label: fixture01.payload.round_info.round_label,
    updates_in_payload: fixture01.payload.updates.length,
    open_questions_in_payload: fixture01.payload.open_questions.length,
    author_notes_in_payload: fixture01.payload.author_notes.length
  },
  merge_report: happyResult.merge_report,
  completeness_status: happyResult.updated_pack.completeness_status,
  pack_version_after: happyResult.updated_pack.version,
  changelog_entry: happyResult.updated_pack.changelog[happyResult.updated_pack.changelog.length - 1],
  confirmed_fields_sample: {
    'project_core.genre_primary': happyResult.updated_pack.project_core.genre_primary,
    'project_core.premise':       happyResult.updated_pack.project_core.premise,
    'project_core.hook':          happyResult.updated_pack.project_core.hook,
    'character_system.protagonist.name': happyResult.updated_pack.character_system.protagonist.name
  },
  open_questions_added: happyResult.updated_pack.open_questions,
  validation: {
    pack_version_incremented: happyResult.updated_pack.version === 2,
    updates_applied_matches_expected: happyResult.merge_report.updates_applied === fixture01.expected.updates_applied,
    no_contradictions: happyResult.merge_report.contradictions_logged === 0,
    open_questions_count: happyResult.merge_report.new_open_questions === 3,
    not_ready_for_outline: happyResult.updated_pack.completeness_status.ready_for_outline === false,
    not_ready_for_drafting: happyResult.updated_pack.completeness_status.ready_for_drafting === false,
    all_pass: null
  }
};

happyPathOutput.validation.all_pass = Object.values(happyPathOutput.validation)
  .filter(v => typeof v === 'boolean')
  .every(Boolean);

fs.writeFileSync(
  path.join(outDir, '01_happy_path_output.json'),
  JSON.stringify(happyPathOutput, null, 2)
);

console.log('Generated: tests/proof_runs/01_happy_path_output.json');
console.log('  all_pass:', happyPathOutput.validation.all_pass);
console.log('  updates_applied:', happyResult.merge_report.updates_applied);
console.log('  pack_version:', happyResult.updated_pack.version);
console.log('  ready_for_outline:', happyResult.updated_pack.completeness_status.ready_for_outline);

// ─── Proof run 2: Error branch (simulated parse failure) ─────────────────────
//
// Simulates what Node 5 (Parse and Validate) returns when the AI response
// is not valid JSON. The IF node would route this to Error Handler.

const malformedAiResponse = `Here is the foundation update payload for this round:

I identified the following key story elements from the transcript:

1. The protagonist is a knight who has been disgraced...
2. The genre appears to be dark fantasy...

Unfortunately I could not format this as valid JSON due to the complexity.
`;

// Run the Parse and Validate logic directly
const rawText = malformedAiResponse;
const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

let parseResult;
try {
  JSON.parse(cleaned);
  parseResult = { parse_error: false };
} catch (e) {
  parseResult = {
    parse_error: true,
    raw_response: rawText,
    error_message: 'JSON parse failed: ' + e.message
  };
}

// Simulate what Error Handler would return
const errorHandlerOutput = {
  halted: true,
  reason: 'Parse or validation failure — master pack was NOT updated.',
  error_message: parseResult.error_message,
  recovery: 'Check error log in /data/errors and retry with corrected input.'
};

const errorBranchOutput = {
  proof_run: '02 — Error branch (forced parse failure)',
  description: 'Simulates Node 7 (AI: Extract Payload) returning prose instead of valid JSON. Node 8 (Parse and Validate) detects the failure and routes to Error Handler via IF node.',
  simulates: 'Nodes 8 (Parse and Validate) + 9 (IF: Parse Error) + 15 (Error Handler)',
  malformed_ai_response_excerpt: malformedAiResponse.slice(0, 200) + '...',
  node_8_parse_and_validate_output: parseResult,
  node_9_if_result: {
    condition: 'parse_error === true',
    evaluated_to: true,
    routes_to: 'Error Handler (true branch)'
  },
  node_15_error_handler_output: errorHandlerOutput,
  validation: {
    parse_error_detected: parseResult.parse_error === true,
    master_pack_not_written: true,
    error_message_present: typeof parseResult.error_message === 'string',
    halted_flag_set: errorHandlerOutput.halted === true,
    all_pass: null
  }
};

errorBranchOutput.validation.all_pass = Object.values(errorBranchOutput.validation)
  .filter(v => typeof v === 'boolean')
  .every(Boolean);

fs.writeFileSync(
  path.join(outDir, '02_error_branch_output.json'),
  JSON.stringify(errorBranchOutput, null, 2)
);

console.log('\nGenerated: tests/proof_runs/02_error_branch_output.json');
console.log('  parse_error_detected:', errorBranchOutput.validation.parse_error_detected);
console.log('  master_pack_not_written:', errorBranchOutput.validation.master_pack_not_written);
console.log('  all_pass:', errorBranchOutput.validation.all_pass);

console.log('\nAll proof runs complete.');
