#!/usr/bin/env node
/**
 * n8n/build_workflow.js
 *
 * Generates n8n/step2_workflow.json from source files.
 * Run: node n8n/build_workflow.js
 *
 * The generated JSON can be imported directly into n8n via
 * Settings > Import Workflow (or the n8n CLI).
 *
 * Re-run this script whenever merge_code_node.js changes.
 * The generated file is the build artifact — edit the source files, not the JSON.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MERGE_CODE = fs.readFileSync(path.join(__dirname, 'merge_code_node.js'), 'utf-8');

/**
 * Deterministic UUID derived from a string seed via SHA-256.
 * Rebuilds produce identical step2_workflow.json unless source changes.
 */
function deterministicUuid(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32)
  ].join('-');
}

// ─── Node code templates ──────────────────────────────────────────────────────
// Each is a complete JS function body for an n8n Code node (typeVersion 2).

const CODE = {

  validateInput: `
const data = $input.first().json;
const body = data.body || data;

const raw_input = (body.raw_input || '').trim();
const round_label = (body.round_label || 'Unlabeled round').trim();

const VALID_TYPES = ['chat_transcript', 'voice_transcript', 'freeform_notes', 'answer_block'];
const input_type = VALID_TYPES.includes(body.input_type) ? body.input_type : 'freeform_notes';

if (!raw_input) {
  throw new Error('Validation failed: raw_input is empty or missing.');
}

return [{ json: { raw_input, round_label, input_type } }];
`.trim(),

  loadCurrentPack: `
const prev = $('Validate Input').first().json;

const packPath = process.env.ONEIROPHANY_PACK_PATH || '/data/story_foundation_pack.json';
const templatePath = process.env.ONEIROPHANY_TEMPLATE_PATH || '/data/story_foundation_pack.template.json';

let current_pack;
try {
  const fsLib = require('fs');
  if (fsLib.existsSync(packPath)) {
    current_pack = JSON.parse(fsLib.readFileSync(packPath, 'utf-8'));
  } else if (fsLib.existsSync(templatePath)) {
    current_pack = JSON.parse(fsLib.readFileSync(templatePath, 'utf-8'));
  } else {
    throw new Error(
      'Neither pack nor template found. ' +
      'Set ONEIROPHANY_PACK_PATH and ONEIROPHANY_TEMPLATE_PATH environment variables.'
    );
  }
} catch (err) {
  throw new Error('Load Current Pack failed: ' + err.message);
}

return [{
  json: {
    raw_input: prev.raw_input,
    round_label: prev.round_label,
    input_type: prev.input_type,
    current_pack
  }
}];
`.trim(),

  buildNormalizeRequest: `
const prev = $('Load Current Pack').first().json;

const systemPrompt = [
  'You are a text normalizer for a story development system.',
  '',
  'Your job is to clean the raw input below so it is easier for an extraction model to process.',
  '',
  'Rules:',
  '- Keep all story content. Do not remove or summarize story ideas.',
  '- Remove meta-conversation (greetings, technical discussions, tangents, filler like "let me rephrase that").',
  '- Remove filler words and repeated phrases from voice transcripts.',
  '- For chat transcripts with speaker labels: keep only the author statements. Remove assistant or interviewer messages.',
  '- Preserve the author own language as much as possible. Do not paraphrase story content.',
  '- Output clean prose or a clean list of statements. Not a summary.',
  '- If the input is already clean, return it as-is.'
].join('\\n');

const userContent = [
  'Input type: ' + prev.input_type,
  '',
  'Raw input:',
  '---',
  prev.raw_input,
  '---',
  '',
  'Normalized output:'
].join('\\n');

return [{
  json: {
    request_body: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    },
    round_label: prev.round_label,
    input_type: prev.input_type,
    current_pack: prev.current_pack
  }
}];
`.trim(),

  buildExtractRequest: `
const normResponse = $('AI: Normalize Text').first().json;
const normalized_text = normResponse.content && normResponse.content[0]
  ? normResponse.content[0].text
  : String(normResponse);

const packData = $('Load Current Pack').first().json;
const round_label = packData.round_label;
const current_pack = packData.current_pack;
const handoff_date = new Date().toISOString().slice(0, 10);

const fieldReference = [
  'project_core: title, format, genre_primary, subgenre, premise, hook, audience, market_position',
  'world_foundation: setting_type, time_period, primary_location, major_world_rules, power_structures, magic_or_power_system, cultures, world_conflicts, secrets',
  'story_engine: central_conflict, story_question, stakes, themes, hooks, pressure_points, reader_experience',
  'character_system: protagonist_name, protagonist_role_summary, protagonist_external_goal, protagonist_internal_need, protagonist_wound, protagonist_flaw, protagonist_arc_direction, protagonist_voice_notes, antagonist_name, antagonist_nature, antagonist_role_summary, antagonist_motivation, antagonist_relationship_to_protagonist, relationship_map, factions',
  'plot_frame: beginning_state, inciting_incident, first_turn, midpoint, darkest_moment, climax, resolution_shape, major_reveals, set_pieces',
  'ending_design: ending_summary, final_image, protagonist_final_state, relationship_end_states, world_state_after, required_payoffs, emotional_ending_feel',
  'author_preferences: pov_preference, prose_register, chapter_length_target, tense_preference, explicit_inspirations, must_include, must_avoid, content_limits, trope_targets, trope_avoids, favorite_elements, non_negotiables, style_preferences, constraints'
].join('\\n');

const systemPrompt = [
  'You are a structured data extractor for a story development system.',
  '',
  'Your job is to read the author statements from this round and extract updates to the story_foundation_pack as a foundation_update_payload.',
  '',
  'Critical rules:',
  '- Only extract information the author actually stated. Do not invent, infer, or embellish.',
  '- Do not infer themes, symbolism, or meaning unless the author explicitly stated them.',
  '- confirmed: stated clearly and directly.',
  '- tentative: stated with hedging language (maybe, possibly, I think, not sure).',
  '- superseded: author explicitly revised a prior statement. Include the replacement value.',
  '- Do not include update records for fields where nothing new was said this round.',
  '- Contradictions: if new input conflicts with an existing confirmed field, log it in contradictions. Do not auto-resolve. Do not overwrite the confirmed field.',
  '- Author preferences and constraints go in author_notes, not in updates.',
  '',
  'Field reference by section:',
  fieldReference,
  '',
  'Return a foundation_update_payload JSON object with these top-level keys:',
  '  round_info: { round_label, source_type, handoff_date }',
  '  summary: string',
  '  updates: [{ section, field, value, status, source_quote, notes }]',
  '  open_questions: [{ question, section, priority, reason }]',
  '  contradictions: [{ section, field, earlier_value, new_value, description, needs_author_resolution }]',
  '  author_notes: [{ type, value, status }]',
  '  completeness_hints: { ready_for_outline, priority_gaps }',
  '',
  'Return only valid JSON. No explanation text outside the JSON object.'
].join('\\n');

const userContent = [
  'Round label: ' + round_label,
  'Handoff date: ' + handoff_date,
  '',
  'Current story_foundation_pack:',
  '---',
  JSON.stringify(current_pack, null, 2),
  '---',
  '',
  'Normalized round input:',
  '---',
  normalized_text,
  '---'
].join('\\n');

return [{
  json: {
    request_body: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    },
    normalized_text,
    round_label,
    current_pack
  }
}];
`.trim(),

  parseAndValidate: `
const response = $input.first().json;
const rawText = response.content && response.content[0]
  ? response.content[0].text
  : String(response);

// Strip markdown code fences if the model wrapped the JSON
const cleaned = rawText.replace(/^\`\`\`json\\s*/i, '').replace(/\\s*\`\`\`$/i, '').trim();

let payload;
try {
  payload = JSON.parse(cleaned);
} catch (e) {
  return [{ json: { parse_error: true, raw_response: rawText, error_message: 'JSON parse failed: ' + e.message } }];
}

// ── Enum sets — mirrors foundation_update_payload.schema.json ─────────────────
const VALID_SECTIONS = new Set([
  'project_core', 'world_foundation', 'story_engine',
  'character_system', 'plot_frame', 'ending_design', 'author_preferences'
]);

const VALID_FIELDS = new Set([
  'title', 'format', 'genre_primary', 'subgenre', 'premise', 'hook', 'audience', 'market_position',
  'setting_type', 'time_period', 'primary_location', 'major_world_rules', 'power_structures',
  'magic_or_power_system', 'cultures', 'world_conflicts', 'secrets',
  'central_conflict', 'story_question', 'stakes', 'themes', 'hooks', 'pressure_points', 'reader_experience',
  'protagonist_name', 'protagonist_role_summary', 'protagonist_external_goal',
  'protagonist_internal_need', 'protagonist_wound', 'protagonist_flaw',
  'protagonist_arc_direction', 'protagonist_voice_notes',
  'antagonist_name', 'antagonist_nature', 'antagonist_role_summary',
  'antagonist_motivation', 'antagonist_relationship_to_protagonist',
  'relationship_map', 'factions',
  'beginning_state', 'inciting_incident', 'first_turn', 'midpoint',
  'darkest_moment', 'climax', 'resolution_shape', 'major_reveals', 'set_pieces',
  'ending_summary', 'final_image', 'protagonist_final_state', 'relationship_end_states',
  'world_state_after', 'required_payoffs', 'emotional_ending_feel',
  'pov_preference', 'prose_register', 'chapter_length_target', 'tense_preference',
  'explicit_inspirations', 'must_include', 'must_avoid', 'content_limits',
  'trope_targets', 'trope_avoids', 'favorite_elements', 'non_negotiables',
  'style_preferences', 'constraints'
]);

const VALID_STATUSES      = new Set(['confirmed', 'tentative', 'superseded']);
const VALID_SOURCE_TYPES  = new Set(['chat', 'voice', 'notes', 'mixed']);
const VALID_PRIORITIES    = new Set(['high', 'medium', 'low']);
const VALID_NOTE_TYPES    = new Set(['must_include', 'must_avoid', 'style_preference', 'constraint', 'inspiration', 'nonnegotiable']);
const VALID_NOTE_STATUSES = new Set(['confirmed', 'tentative']);
const VALID_Q_SECTIONS    = new Set([...VALID_SECTIONS, 'general']);

function fail(msg) {
  return [{ json: { parse_error: true, raw_response: rawText, error_message: msg } }];
}

// ── round_info ────────────────────────────────────────────────────────────────
if (!payload.round_info || typeof payload.round_info !== 'object') {
  return fail('round_info object missing from payload');
}
if (!payload.round_info.round_label || typeof payload.round_info.round_label !== 'string') {
  return fail('round_info.round_label missing or not a string');
}
if (!VALID_SOURCE_TYPES.has(payload.round_info.source_type)) {
  return fail('round_info.source_type invalid: "' + payload.round_info.source_type +
              '". Expected one of: ' + [...VALID_SOURCE_TYPES].join(', '));
}
if (!payload.round_info.handoff_date || !/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.round_info.handoff_date)) {
  return fail('round_info.handoff_date missing or not ISO date (YYYY-MM-DD): ' + payload.round_info.handoff_date);
}

// ── updates ───────────────────────────────────────────────────────────────────
if (!payload.updates || !Array.isArray(payload.updates)) {
  return fail('updates array missing from payload');
}
for (let i = 0; i < payload.updates.length; i++) {
  const u = payload.updates[i];
  if (!u.section || !VALID_SECTIONS.has(u.section)) {
    return fail('updates[' + i + '] invalid section: "' + u.section + '"');
  }
  if (!u.field || !VALID_FIELDS.has(u.field)) {
    return fail('updates[' + i + '] invalid field: "' + u.field + '"');
  }
  if (!VALID_STATUSES.has(u.status)) {
    return fail('updates[' + i + '] invalid status: "' + u.status + '"');
  }
  const v = u.value;
  if (v !== null && typeof v !== 'string' && !Array.isArray(v)) {
    return fail('updates[' + i + '].value must be string, array of strings, or null');
  }
  if (Array.isArray(v) && !v.every(el => typeof el === 'string')) {
    return fail('updates[' + i + '].value array must contain only strings');
  }
}

// ── open_questions ────────────────────────────────────────────────────────────
if (!Array.isArray(payload.open_questions)) payload.open_questions = [];
for (let i = 0; i < payload.open_questions.length; i++) {
  const q = payload.open_questions[i];
  if (!q.question || typeof q.question !== 'string') {
    return fail('open_questions[' + i + '].question missing or not a string');
  }
  if (!q.section || !VALID_Q_SECTIONS.has(q.section)) {
    return fail('open_questions[' + i + '].section invalid: "' + q.section + '"');
  }
  if (!q.priority || !VALID_PRIORITIES.has(q.priority)) {
    return fail('open_questions[' + i + '].priority invalid: "' + q.priority + '"');
  }
}

// ── contradictions ────────────────────────────────────────────────────────────
if (!Array.isArray(payload.contradictions)) payload.contradictions = [];
for (let i = 0; i < payload.contradictions.length; i++) {
  const c = payload.contradictions[i];
  if (!c.section || !c.field) {
    return fail('contradictions[' + i + '] missing section or field');
  }
  if (typeof c.description !== 'string') {
    return fail('contradictions[' + i + '].description must be a string');
  }
}

// ── author_notes ──────────────────────────────────────────────────────────────
if (!Array.isArray(payload.author_notes)) payload.author_notes = [];
for (let i = 0; i < payload.author_notes.length; i++) {
  const n = payload.author_notes[i];
  if (!n.type || !VALID_NOTE_TYPES.has(n.type)) {
    return fail('author_notes[' + i + '].type invalid: "' + n.type +
                '". Expected one of: ' + [...VALID_NOTE_TYPES].join(', '));
  }
  if (typeof n.value !== 'string') {
    return fail('author_notes[' + i + '].value must be a string');
  }
  if (!VALID_NOTE_STATUSES.has(n.status)) {
    return fail('author_notes[' + i + '].status invalid: "' + n.status + '"');
  }
}

// ── completeness_hints ────────────────────────────────────────────────────────
if (!payload.completeness_hints) {
  payload.completeness_hints = { ready_for_outline: false, priority_gaps: [] };
} else {
  if (typeof payload.completeness_hints.ready_for_outline !== 'boolean') {
    return fail('completeness_hints.ready_for_outline must be a boolean');
  }
  if (!Array.isArray(payload.completeness_hints.priority_gaps)) {
    payload.completeness_hints.priority_gaps = [];
  }
}

return [{ json: { parse_error: false, payload } }];
`.trim(),

  buildNextQuestionsRequest: `
const mergeResult = $('Merge Patches').first().json;
const pack = mergeResult.updated_pack;
const report = mergeResult.merge_report;

const unresolvedQuestions = (pack.open_questions || []).filter(q => !q.resolved);

const systemPrompt = [
  'You are helping a story development system prepare for the next interview round.',
  '',
  'Based on the updated story foundation pack status and blocking issues below, generate the 5 to 10 most important questions to ask the author next.',
  '',
  'Prioritize:',
  '1. Fields listed in blocking_issues',
  '2. High-priority open questions that are still unresolved',
  '3. Sections that are partial or not_started',
  '',
  'Rules:',
  '- Ask open questions only. Do not suggest answers or embed ideas in the question.',
  '- Do not repeat questions already in the open_questions list unless still unresolved and high priority.',
  '- Each question should be specific enough to move the story forward.',
  '',
  'Return a JSON array of objects. Each object: { question: string, section: string, why: string }',
  'Return only valid JSON. No explanation text outside the array.'
].join('\\n');

const userContent = [
  'Completeness status:',
  JSON.stringify(pack.completeness_status, null, 2),
  '',
  'Blocking issues:',
  (report.blocking_issues || []).join('\\n') || 'None',
  '',
  'Current unresolved open questions:',
  JSON.stringify(unresolvedQuestions, null, 2)
].join('\\n');

return [{
  json: {
    request_body: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    },
    updated_pack: pack,
    merge_report: report,
    round_summary: mergeResult.round_summary
  }
}];
`.trim(),

  saveOutputs: `
const prev = $('Build Next Questions Request').first().json;
const nqResponse = $('AI: Next Questions').first().json;

const pack = prev.updated_pack;
const report = prev.merge_report;
const round_summary = prev.round_summary;

// Parse next questions from AI response
const nqRawText = nqResponse.content && nqResponse.content[0]
  ? nqResponse.content[0].text
  : '[]';

let next_questions = [];
try {
  const nqCleaned = nqRawText.replace(/^\`\`\`json\\s*/i, '').replace(/\\s*\`\`\`$/i, '').trim();
  next_questions = JSON.parse(nqCleaned);
} catch (e) {
  next_questions = [{
    question: 'Error parsing next questions — check raw AI output.',
    section: 'general',
    why: 'parse failure: ' + e.message
  }];
}

const packPath    = process.env.ONEIROPHANY_PACK_PATH     || '/data/story_foundation_pack.json';
const logPath     = process.env.ONEIROPHANY_LOG_PATH      || '/data/rounds/round_' + pack.version + '.json';
const nextQPath   = process.env.ONEIROPHANY_NEXT_Q_PATH   || '/data/next_questions.json';

const roundLog = {
  version: pack.version,
  timestamp: pack.last_modified,
  round_label: pack.changelog[pack.changelog.length - 1].round_label,
  summary: round_summary,
  merge_report: report,
  next_questions
};

try {
  const fsLib   = require('fs');
  const pathLib = require('path');

  // Ensure all output parent directories exist
  const packDir  = pathLib.dirname(packPath);
  const logDir   = pathLib.dirname(logPath);
  const nextQDir = pathLib.dirname(nextQPath);
  if (!fsLib.existsSync(packDir))  fsLib.mkdirSync(packDir,  { recursive: true });
  if (!fsLib.existsSync(logDir))   fsLib.mkdirSync(logDir,   { recursive: true });
  if (!fsLib.existsSync(nextQDir)) fsLib.mkdirSync(nextQDir, { recursive: true });

  // Write master pack — only reached on successful parse + merge
  fsLib.writeFileSync(packPath, JSON.stringify(pack, null, 2));

  // Write round log
  fsLib.writeFileSync(logPath, JSON.stringify(roundLog, null, 2));

  // Write next questions (overwrite each round — ephemeral artifact)
  fsLib.writeFileSync(nextQPath, JSON.stringify(next_questions, null, 2));

} catch (err) {
  throw new Error('Save Outputs failed: ' + err.message);
}

return [{
  json: {
    success: true,
    version: pack.version,
    round_summary,
    ready_for_outline: pack.completeness_status.ready_for_outline,
    ready_for_drafting: pack.completeness_status.ready_for_drafting,
    blocking_issues: pack.completeness_status.blocking_issues,
    next_questions,
    merge_report: report
  }
}];
`.trim(),

  errorHandler: `
const data = $input.first().json;
const errorPath = process.env.ONEIROPHANY_ERROR_PATH || '/data/errors';

const errorRecord = {
  timestamp: new Date().toISOString(),
  error_message: data.error_message || 'Unknown error',
  raw_response: data.raw_response || null
};

try {
  const fsLib = require('fs');
  if (!fsLib.existsSync(errorPath)) fsLib.mkdirSync(errorPath, { recursive: true });
  const filename = errorPath + '/error_' + Date.now() + '.json';
  fsLib.writeFileSync(filename, JSON.stringify(errorRecord, null, 2));
} catch (writeErr) {
  console.error('Error Handler: could not write error file:', writeErr.message);
  console.error('Error details:', JSON.stringify(errorRecord));
}

// Master pack is NOT written — this node is only reached on error path.
return [{
  json: {
    halted: true,
    reason: 'Parse or validation failure — master pack was NOT updated.',
    error_message: data.error_message,
    recovery: 'Check error log in ' + (process.env.ONEIROPHANY_ERROR_PATH || '/data/errors') + ' and retry with corrected input.'
  }
}];
`.trim()

};

// ─── Node builders ────────────────────────────────────────────────────────────

function codeNode(name, position, jsCode) {
  return {
    id: deterministicUuid(name + '-node'),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { jsCode }
  };
}

function httpRequestNode(name, position) {
  return {
    id: deterministicUuid(name + '-node'),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    parameters: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'x-api-key',          value: '={{ $env.ANTHROPIC_API_KEY }}' },
          { name: 'anthropic-version',   value: '2023-06-01' },
          { name: 'content-type',        value: 'application/json' }
        ]
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: '={{ JSON.stringify($input.first().json.request_body) }}',
      options: {}
    }
  };
}

// ─── Assemble nodes ───────────────────────────────────────────────────────────

const webhookId = deterministicUuid('Webhook-webhookId');

const nodes = [

  // 1 — Receive input
  {
    id: deterministicUuid('Webhook-node'),
    name: 'Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 1.1,
    position: [260, 380],
    parameters: {
      path: 'foundation-processor',
      responseMode: 'lastNode',
      responseData: 'allEntries',
      httpMethod: 'POST',
      options: {}
    },
    webhookId
  },

  // 2 — Guardrails + input normalization
  codeNode('Validate Input',            [480, 380],  CODE.validateInput),

  // 3 — Load JSON master or template fallback
  codeNode('Load Current Pack',         [700, 380],  CODE.loadCurrentPack),

  // 4 — Build Anthropic request body for normalization
  codeNode('Build Normalize Request',   [920, 380],  CODE.buildNormalizeRequest),

  // 5 — Call AI to normalize raw input
  httpRequestNode('AI: Normalize Text', [1140, 380]),

  // 6 — Build Anthropic request body for extraction
  codeNode('Build Extract Request',     [1360, 380], CODE.buildExtractRequest),

  // 7 — Call AI to extract foundation_update_payload
  httpRequestNode('AI: Extract Payload',[1580, 380]),

  // 8 — Parse JSON and validate payload structure
  codeNode('Parse and Validate',        [1800, 380], CODE.parseAndValidate),

  // 9 — Route on parse_error flag
  {
    id: deterministicUuid('IF: Parse Error-node'),
    name: 'IF: Parse Error',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [2020, 380],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: deterministicUuid('IF: Parse Error-condition-0'),
            leftValue: '={{ $json.parse_error }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }
        ],
        combinator: 'and'
      }
    }
  },

  // 10 — Apply updates to pack (merge_code_node.js inlined)
  //      Input must be: { payload: <parsed_payload>, current_pack: <loaded_pack> }
  //      The merge code reads $input.first().json = { payload, current_pack }
  //      We wire: Parse and Validate (false branch) → transform → Merge Patches
  //      The Code node below reshapes the data before merge:
  {
    id: deterministicUuid('Prepare Merge Input-node'),
    name: 'Prepare Merge Input',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2240, 240],
    parameters: {
      jsCode: [
        "const validated = $('Parse and Validate').first().json;",
        "const packData   = $('Load Current Pack').first().json;",
        "return [{ json: { payload: validated.payload, current_pack: packData.current_pack } }];"
      ].join('\n')
    }
  },

  codeNode('Merge Patches',             [2460, 240], MERGE_CODE),

  // 11 — Build next questions request
  codeNode('Build Next Questions Request', [2680, 240], CODE.buildNextQuestionsRequest),

  // 12 — Call AI for next interview questions
  httpRequestNode('AI: Next Questions', [2900, 240]),

  // 13 — Write pack + round log + next questions doc
  codeNode('Save Outputs',              [3120, 240], CODE.saveOutputs),

  // 14 — Error branch: log, save raw response, halt
  codeNode('Error Handler',             [2240, 520], CODE.errorHandler)

];

// ─── Connections ──────────────────────────────────────────────────────────────

const connections = {
  'Webhook': {
    main: [[{ node: 'Validate Input', type: 'main', index: 0 }]]
  },
  'Validate Input': {
    main: [[{ node: 'Load Current Pack', type: 'main', index: 0 }]]
  },
  'Load Current Pack': {
    main: [[{ node: 'Build Normalize Request', type: 'main', index: 0 }]]
  },
  'Build Normalize Request': {
    main: [[{ node: 'AI: Normalize Text', type: 'main', index: 0 }]]
  },
  'AI: Normalize Text': {
    main: [[{ node: 'Build Extract Request', type: 'main', index: 0 }]]
  },
  'Build Extract Request': {
    main: [[{ node: 'AI: Extract Payload', type: 'main', index: 0 }]]
  },
  'AI: Extract Payload': {
    main: [[{ node: 'Parse and Validate', type: 'main', index: 0 }]]
  },
  'Parse and Validate': {
    main: [[{ node: 'IF: Parse Error', type: 'main', index: 0 }]]
  },
  'IF: Parse Error': {
    main: [
      [{ node: 'Error Handler',      type: 'main', index: 0 }],  // true  — parse_error
      [{ node: 'Prepare Merge Input',type: 'main', index: 0 }]   // false — valid payload
    ]
  },
  'Prepare Merge Input': {
    main: [[{ node: 'Merge Patches', type: 'main', index: 0 }]]
  },
  'Merge Patches': {
    main: [[{ node: 'Build Next Questions Request', type: 'main', index: 0 }]]
  },
  'Build Next Questions Request': {
    main: [[{ node: 'AI: Next Questions', type: 'main', index: 0 }]]
  },
  'AI: Next Questions': {
    main: [[{ node: 'Save Outputs', type: 'main', index: 0 }]]
  }
  // Save Outputs and Error Handler are terminal nodes — no outgoing connections
};

// ─── Workflow object ──────────────────────────────────────────────────────────

const workflow = {
  name: 'Oneirophany \u2014 Step 2 Foundation Processor',
  nodes,
  pinData: {},
  connections,
  active: false,
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    callerPolicy: 'workflowsFromSameOwner'
  },
  versionId: deterministicUuid('step2-foundation-processor-versionId'),
  meta: {
    instanceId: 'oneirophany-step2',
    templateCredsSetupCompleted: false
  },
  id: 'step2-foundation-processor',
  tags: [{ name: 'oneirophany' }, { name: 'step2' }]
};

// ─── Write output ─────────────────────────────────────────────────────────────

const outputPath = path.join(__dirname, 'step2_workflow.json');
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));

const nodeNames = nodes.map(n => n.name);
console.log('Generated: ' + outputPath);
console.log('Nodes (' + nodes.length + '):');
nodeNames.forEach((n, i) => console.log('  ' + (i + 1) + '. ' + n));
console.log('\nImport into n8n: Settings > Import Workflow > select step2_workflow.json');
console.log('Set environment variables before activating (see n8n/step2_runbook.md).');
