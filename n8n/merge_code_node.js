/**
 * Step 2 — Merge Code Node
 *
 * Applies a foundation_update_payload to the current story_foundation_pack.
 * This node governs canon. The model only extracts — this node decides what sticks.
 *
 * Inputs (from previous node):
 *   $input.first().json = { payload, current_pack }
 *
 *   payload:      foundation_update_payload object (parsed, validated)
 *   current_pack: story_foundation_pack object (loaded from JSON master)
 *
 * Output:
 *   {
 *     updated_pack:     story_foundation_pack,
 *     merge_report:     summary of what happened,
 *     round_summary:    from payload
 *   }
 */

const input = $input.first().json;
const payload = input.payload;
const pack = JSON.parse(JSON.stringify(input.current_pack)); // deep clone — never mutate the original
const now = new Date().toISOString();

// ─── Pack normalizer ──────────────────────────────────────────────────────────
//
// Ensures the pack has the expected top-level shape before anything touches it.
// Prevents path resolution failures when working with a partially initialized pack.

function ensureObject(obj, key) {
  if (!obj[key] || typeof obj[key] !== "object" || Array.isArray(obj[key])) {
    obj[key] = {};
  }
}

ensureObject(pack, "project_core");
ensureObject(pack, "world_foundation");
ensureObject(pack, "story_engine");
ensureObject(pack, "character_system");
ensureObject(pack, "plot_frame");
ensureObject(pack, "ending_design");
ensureObject(pack, "author_preferences");
ensureObject(pack, "completeness_status");
ensureObject(pack.character_system, "protagonist");
ensureObject(pack.character_system, "antagonist_or_opposing_force");

if (!Array.isArray(pack.open_questions)) pack.open_questions = [];
if (!Array.isArray(pack.changelog)) pack.changelog = [];

// ─── Field mapping ────────────────────────────────────────────────────────────
//
// Translates section.field keys from the payload to nested paths in the pack.

const FIELD_MAP = {
  // project_core
  "project_core.title":           ["project_core", "title"],
  "project_core.format":          ["project_core", "format"],
  "project_core.genre_primary":   ["project_core", "genre_primary"],
  "project_core.subgenre":        ["project_core", "subgenre"],
  "project_core.premise":         ["project_core", "premise"],
  "project_core.hook":            ["project_core", "hook"],
  "project_core.audience":        ["project_core", "audience"],
  "project_core.market_position": ["project_core", "market_position"],

  // world_foundation
  "world_foundation.setting_type":           ["world_foundation", "setting_type"],
  "world_foundation.time_period":            ["world_foundation", "time_period"],
  "world_foundation.primary_location":       ["world_foundation", "primary_location"],
  "world_foundation.major_world_rules":      ["world_foundation", "major_world_rules"],
  "world_foundation.power_structures":       ["world_foundation", "power_structures"],
  "world_foundation.magic_or_power_system":  ["world_foundation", "magic_or_power_system"],
  "world_foundation.cultures":               ["world_foundation", "cultures"],
  "world_foundation.world_conflicts":        ["world_foundation", "world_conflicts"],
  "world_foundation.secrets":                ["world_foundation", "secrets"],

  // story_engine
  "story_engine.central_conflict":  ["story_engine", "central_conflict"],
  "story_engine.story_question":    ["story_engine", "story_question"],
  "story_engine.stakes":            ["story_engine", "stakes"],
  "story_engine.themes":            ["story_engine", "themes"],
  "story_engine.hooks":             ["story_engine", "hooks"],
  "story_engine.pressure_points":   ["story_engine", "pressure_points"],
  "story_engine.reader_experience": ["story_engine", "reader_experience"],

  // character_system — protagonist
  "character_system.protagonist_name":          ["character_system", "protagonist", "name"],
  "character_system.protagonist_role_summary":  ["character_system", "protagonist", "role_summary"],
  "character_system.protagonist_external_goal": ["character_system", "protagonist", "external_want"],
  "character_system.protagonist_internal_need": ["character_system", "protagonist", "internal_need"],
  "character_system.protagonist_wound":         ["character_system", "protagonist", "wound"],
  "character_system.protagonist_flaw":          ["character_system", "protagonist", "flaw"],
  "character_system.protagonist_arc_direction": ["character_system", "protagonist", "arc_direction"],
  "character_system.protagonist_voice_notes":   ["character_system", "protagonist", "voice_notes"],

  // character_system — antagonist
  "character_system.antagonist_name":                        ["character_system", "antagonist_or_opposing_force", "name"],
  "character_system.antagonist_nature":                      ["character_system", "antagonist_or_opposing_force", "nature"],
  "character_system.antagonist_role_summary":                ["character_system", "antagonist_or_opposing_force", "role_summary"],
  "character_system.antagonist_motivation":                  ["character_system", "antagonist_or_opposing_force", "motivation"],
  "character_system.antagonist_relationship_to_protagonist": ["character_system", "antagonist_or_opposing_force", "relationship_to_protagonist"],

  // character_system — other
  "character_system.relationship_map": ["character_system", "relationship_map"],
  "character_system.factions":         ["character_system", "factions"],

  // plot_frame
  "plot_frame.beginning_state":   ["plot_frame", "beginning_state"],
  "plot_frame.inciting_incident": ["plot_frame", "inciting_incident"],
  "plot_frame.first_turn":        ["plot_frame", "first_turn"],
  "plot_frame.midpoint":          ["plot_frame", "midpoint"],
  "plot_frame.darkest_moment":    ["plot_frame", "darkest_moment"],
  "plot_frame.climax":            ["plot_frame", "climax"],
  "plot_frame.resolution_shape":  ["plot_frame", "resolution_shape"],
  "plot_frame.major_reveals":     ["plot_frame", "major_reveals"],
  "plot_frame.set_pieces":        ["plot_frame", "set_pieces"],

  // ending_design
  "ending_design.ending_summary":          ["ending_design", "ending_summary"],
  "ending_design.final_image":             ["ending_design", "final_image"],
  "ending_design.protagonist_final_state": ["ending_design", "protagonist_final_state"],
  "ending_design.relationship_end_states": ["ending_design", "relationship_end_states"],
  "ending_design.world_state_after":       ["ending_design", "world_state_after"],
  "ending_design.required_payoffs":        ["ending_design", "required_payoffs"],
  "ending_design.emotional_ending_feel":   ["ending_design", "emotional_ending_feel"],

  // author_preferences
  "author_preferences.pov_preference":        ["author_preferences", "pov_preference"],
  "author_preferences.prose_register":        ["author_preferences", "prose_register"],
  "author_preferences.chapter_length_target": ["author_preferences", "chapter_length_target"],
  "author_preferences.tense_preference":      ["author_preferences", "tense_preference"],
  "author_preferences.explicit_inspirations": ["author_preferences", "explicit_inspirations"],
  "author_preferences.must_include":          ["author_preferences", "must_include"],
  "author_preferences.must_avoid":            ["author_preferences", "must_avoid"],
  "author_preferences.content_limits":        ["author_preferences", "content_limits"],
  "author_preferences.trope_targets":         ["author_preferences", "trope_targets"],
  "author_preferences.trope_avoids":          ["author_preferences", "trope_avoids"],
  "author_preferences.favorite_elements":     ["author_preferences", "favorite_elements"],
  "author_preferences.non_negotiables":       ["author_preferences", "non_negotiables"],
  "author_preferences.style_preferences":     ["author_preferences", "style_preferences"],
  "author_preferences.constraints":           ["author_preferences", "constraints"]
};

// ─── Array field registry ─────────────────────────────────────────────────────
//
// Canonical set of fields that hold arrays of strings.
// Used instead of inspecting the existing field shape, which is unreliable
// when a field has never been written yet.

const ARRAY_FIELDS = new Set([
  "world_foundation.major_world_rules",
  "world_foundation.power_structures",
  "world_foundation.cultures",
  "world_foundation.world_conflicts",
  "world_foundation.secrets",
  "story_engine.themes",
  "story_engine.hooks",
  "story_engine.pressure_points",
  "character_system.protagonist_voice_notes",
  "character_system.relationship_map",
  "character_system.factions",
  "plot_frame.major_reveals",
  "plot_frame.set_pieces",
  "ending_design.relationship_end_states",
  "ending_design.required_payoffs",
  "author_preferences.explicit_inspirations",
  "author_preferences.must_include",
  "author_preferences.must_avoid",
  "author_preferences.trope_targets",
  "author_preferences.trope_avoids",
  "author_preferences.favorite_elements",
  "author_preferences.non_negotiables",
  "author_preferences.style_preferences",
  "author_preferences.constraints"
]);

// ─── Author note type mapping ─────────────────────────────────────────────────

const AUTHOR_NOTE_TYPE_MAP = {
  must_include:     "must_include",
  must_avoid:       "must_avoid",
  style_preference: "style_preferences",
  constraint:       "constraints",
  inspiration:      "explicit_inspirations",
  nonnegotiable:    "non_negotiables"
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePackPath(pathParts) {
  let cursor = pack;
  for (let i = 0; i < pathParts.length - 1; i++) {
    if (cursor == null || typeof cursor !== "object") return null;
    cursor = cursor[pathParts[i]];
  }
  if (cursor == null || typeof cursor !== "object") return null;
  return { parent: cursor, key: pathParts[pathParts.length - 1] };
}

function getSectionStatus(sectionName) {
  return pack.completeness_status && pack.completeness_status[sectionName];
}

// ─── Tracking ─────────────────────────────────────────────────────────────────

let updatesApplied = 0;
const skipped = [];
const lockedSkips = [];
const contradictionsLogged = [];    // all contradictions, tagged by source
const newOpenQuestions = [];
const authorNotesApplied = [];

// ─── Apply updates ─────────────────────────────────────────────────────────────

for (const update of payload.updates || []) {
  const { section, field, value, status, source_quote, notes } = update;
  const mapKey = `${section}.${field}`;
  const pathParts = FIELD_MAP[mapKey];

  if (!pathParts) {
    skipped.push({ section, field, reason: `No mapping found for "${mapKey}"` });
    continue;
  }

  // Hard stop: never touch locked sections
  if (getSectionStatus(section) === "locked") {
    lockedSkips.push({ section, field, reason: `Section "${section}" is locked` });
    continue;
  }

  const ref = resolvePackPath(pathParts);
  if (!ref) {
    skipped.push({ section, field, reason: `Path not found in pack: ${pathParts.join(".")}` });
    continue;
  }

  const currentField = ref.parent[ref.key];
  const currentStatus = currentField && currentField.status ? currentField.status : "unresolved";
  const isArray = ARRAY_FIELDS.has(mapKey);

  // Merge rules:
  //   confirmed  → fill blank/tentative/unresolved/superseded; do NOT overwrite confirmed (log contradiction)
  //   tentative  → fill blank/unresolved/tentative only; never overwrite confirmed
  //   superseded → apply only if a prior value exists; guard against nonsense

  if (status === "confirmed") {
    if (currentStatus === "confirmed") {
      if (JSON.stringify(currentField.value) !== JSON.stringify(value)) {
        contradictionsLogged.push({
          source: "merge_guard",
          section, field,
          earlier_value: currentField.value,
          new_value: value,
          description: "New confirmed value differs from existing confirmed value. Author review required.",
          needs_author_resolution: true
        });
        skipped.push({ section, field, reason: "Confirmed field conflict — logged as contradiction, not overwritten" });
      } else {
        skipped.push({ section, field, reason: "Value unchanged — skipped" });
      }
      continue;
    }

  } else if (status === "tentative") {
    if (currentStatus === "confirmed") {
      skipped.push({ section, field, reason: "Cannot overwrite confirmed field with tentative value" });
      continue;
    }

  } else if (status === "superseded") {
    // Guard: don't apply superseded if there is no existing value to supersede
    if (!currentField || currentStatus === "unresolved") {
      skipped.push({ section, field, reason: "Superseded status requires an existing value — none found, skipped" });
      continue;
    }
  }

  if (isArray) {
    // Array merge: combine existing items with incoming items, dedupe
    const existing = currentField && Array.isArray(currentField.value) ? currentField.value : [];
    const incoming = Array.isArray(value) ? value : (value ? [value] : []);
    const merged = Array.from(new Set([...existing, ...incoming]));

    // Array status: use "max confidence" — do not downgrade a confirmed array to tentative
    const finalStatus =
      currentStatus === "confirmed" || status === "confirmed" ? "confirmed" : status;

    ref.parent[ref.key] = {
      value: merged,
      status: finalStatus,
      ...(source_quote ? { source_quote } : {}),
      ...(notes ? { notes } : {}),
      set_in_version: (pack.version || 0) + 1
    };
  } else {
    ref.parent[ref.key] = {
      value,
      status,
      ...(source_quote ? { source_quote } : {}),
      ...(notes ? { notes } : {}),
      set_in_version: (pack.version || 0) + 1
    };
  }

  updatesApplied++;
}

// ─── Merge author_notes into author_preferences ───────────────────────────────

for (const note of payload.author_notes || []) {
  const packField = AUTHOR_NOTE_TYPE_MAP[note.type];
  if (!packField) continue;

  const ref = resolvePackPath(["author_preferences", packField]);
  if (!ref) continue;

  const currentField = ref.parent[ref.key];
  const currentStatus = currentField && currentField.status ? currentField.status : "unresolved";

  if (currentStatus === "confirmed" && note.status === "tentative") {
    skipped.push({ section: "author_preferences", field: packField, reason: "Cannot overwrite confirmed with tentative author note" });
    continue;
  }

  const existing = currentField && Array.isArray(currentField.value) ? currentField.value : [];
  if (!existing.includes(note.value)) {
    const finalStatus =
      currentStatus === "confirmed" || note.status === "confirmed" ? "confirmed" : note.status;
    ref.parent[ref.key] = {
      value: [...existing, note.value],
      status: finalStatus,
      set_in_version: (pack.version || 0) + 1
    };
    authorNotesApplied.push(note);
    updatesApplied++;
  }
}

// ─── Log contradictions from payload ─────────────────────────────────────────
//
// Tag with source: "payload" to distinguish from contradictions caught by merge_guard above.
// Dedupe against any merge_guard contradictions already logged for the same section.field.

const mergeGuardKeys = new Set(
  contradictionsLogged.map(c => `${c.section}.${c.field}`)
);

for (const c of payload.contradictions || []) {
  const key = `${c.section}.${c.field}`;
  if (mergeGuardKeys.has(key)) continue; // already caught by merge_guard, skip duplicate
  contradictionsLogged.push({ source: "payload", ...c });
}

// ─── Add open questions (with dedupe) ────────────────────────────────────────

let nextOqId = pack.open_questions.length + 1;

for (const oq of payload.open_questions || []) {
  // Dedupe: skip if an identical unresolved question already exists
  const alreadyExists = pack.open_questions.some(
    existing =>
      existing.question.trim().toLowerCase() === oq.question.trim().toLowerCase() &&
      existing.section === oq.section &&
      !existing.resolved
  );
  if (alreadyExists) continue;

  const id = `oq_${String(nextOqId).padStart(3, "0")}`;
  newOpenQuestions.push({
    id,
    question: oq.question,
    section: oq.section,
    priority: oq.priority,
    reason: oq.reason || "",
    added_in_version: (pack.version || 0) + 1,
    resolved: false
  });
  nextOqId++;
}

pack.open_questions.push(...newOpenQuestions);

// ─── Compute completeness ─────────────────────────────────────────────────────

const REQUIRED_FIELDS_MAP = {
  project_core: [
    ["project_core", "premise"],
    ["project_core", "genre_primary"],
    ["project_core", "hook"]
  ],
  world_foundation: [
    ["world_foundation", "setting_type"],
    ["world_foundation", "major_world_rules"]
  ],
  story_engine: [
    ["story_engine", "central_conflict"],
    ["story_engine", "story_question"],
    ["story_engine", "stakes"]
  ],
  character_system: [
    ["character_system", "protagonist", "name"],
    ["character_system", "protagonist", "external_want"],
    ["character_system", "protagonist", "internal_need"],
    ["character_system", "protagonist", "wound"],
    ["character_system", "antagonist_or_opposing_force", "nature"],
    ["character_system", "antagonist_or_opposing_force", "role_summary"]
  ],
  plot_frame: [
    ["plot_frame", "beginning_state"],
    ["plot_frame", "inciting_incident"],
    ["plot_frame", "first_turn"],
    ["plot_frame", "climax"]
  ],
  ending_design: [
    ["ending_design", "ending_summary"],
    ["ending_design", "emotional_ending_feel"],
    ["ending_design", "required_payoffs"]
  ],
  author_preferences: [
    ["author_preferences", "pov_preference"],
    ["author_preferences", "prose_register"]
  ]
};

function assessSection(sectionName) {
  const current = pack.completeness_status[sectionName];
  if (current === "locked") return "locked";

  const required = REQUIRED_FIELDS_MAP[sectionName] || [];
  let confirmedCount = 0;

  for (const pathParts of required) {
    const ref = resolvePackPath(pathParts);
    if (!ref) continue;
    const field = ref.parent[ref.key];
    if (!field) continue;
    if (Array.isArray(field.value)) {
      if (field.status === "confirmed" && field.value.length > 0) confirmedCount++;
    } else {
      if (field.status === "confirmed" && field.value !== null) confirmedCount++;
    }
  }

  if (confirmedCount === 0) return "not_started";
  if (confirmedCount < required.length) return "partial";
  return "sufficient";
}

function computeCompleteness() {
  const sections = Object.keys(REQUIRED_FIELDS_MAP);
  const newStatus = { ...pack.completeness_status };
  const blockingIssues = [];

  for (const section of sections) {
    newStatus[section] = assessSection(section);
  }

  const levels = sections.map(s => newStatus[s]);
  if (levels.every(l => l === "not_started")) {
    newStatus.overall = "not_started";
  } else if (levels.every(l => l === "sufficient" || l === "locked")) {
    newStatus.overall = "sufficient";
  } else {
    newStatus.overall = "partial";
  }

  const outlineReady =
    (newStatus.project_core === "sufficient" || newStatus.project_core === "locked") &&
    (newStatus.story_engine === "sufficient" || newStatus.story_engine === "locked") &&
    (newStatus.character_system === "sufficient" || newStatus.character_system === "locked") &&
    ["partial", "sufficient", "locked"].includes(newStatus.plot_frame) &&
    ["partial", "sufficient", "locked"].includes(newStatus.ending_design);

  const unresolvedHighPriority = pack.open_questions.filter(
    oq => oq.priority === "high" && !oq.resolved
  ).length;

  const draftingReady =
    outlineReady &&
    (newStatus.world_foundation === "sufficient" || newStatus.world_foundation === "locked") &&
    (newStatus.plot_frame === "sufficient" || newStatus.plot_frame === "locked") &&
    (newStatus.ending_design === "sufficient" || newStatus.ending_design === "locked") &&
    (newStatus.author_preferences === "sufficient" || newStatus.author_preferences === "locked") &&
    unresolvedHighPriority === 0;

  newStatus.ready_for_outline = outlineReady;
  newStatus.ready_for_drafting = draftingReady;

  if (!outlineReady) {
    for (const s of ["project_core", "story_engine", "character_system"]) {
      if (newStatus[s] !== "sufficient" && newStatus[s] !== "locked") {
        blockingIssues.push(`${s} is ${newStatus[s]} — required for outline`);
      }
    }
    if (!["partial", "sufficient", "locked"].includes(newStatus.ending_design)) {
      blockingIssues.push("ending_design has no content — at least ending_summary required");
    }
  }

  if (!draftingReady && outlineReady) {
    for (const s of ["world_foundation", "plot_frame", "ending_design", "author_preferences"]) {
      if (newStatus[s] !== "sufficient" && newStatus[s] !== "locked") {
        blockingIssues.push(`${s} is ${newStatus[s]} — required for drafting`);
      }
    }
    if (unresolvedHighPriority > 0) {
      blockingIssues.push(`${unresolvedHighPriority} high-priority open question(s) unresolved`);
    }
  }

  if (contradictionsLogged.length > 0) {
    blockingIssues.push(
      `${contradictionsLogged.length} unresolved contradiction(s) logged this round — human review required`
    );
  }

  newStatus.blocking_issues = blockingIssues;
  return newStatus;
}

pack.completeness_status = computeCompleteness();

// ─── Version and changelog ────────────────────────────────────────────────────

const previousVersion = pack.version || 0;
pack.version = previousVersion + 1;
pack.last_modified = now;

pack.changelog.push({
  version: pack.version,
  timestamp: now,
  round_label: payload.round_info ? payload.round_info.round_label : "Unknown round",
  summary: payload.summary || "No summary provided.",
  patches_applied: updatesApplied
});

// ─── Output ───────────────────────────────────────────────────────────────────

return [{
  json: {
    updated_pack: pack,
    merge_report: {
      version: pack.version,
      updates_applied: updatesApplied,
      updates_skipped: skipped.length,
      locked_skips: lockedSkips.length,
      contradictions_logged: contradictionsLogged.length,
      new_open_questions: newOpenQuestions.length,
      author_notes_applied: authorNotesApplied.length,
      ready_for_outline: pack.completeness_status.ready_for_outline,
      ready_for_drafting: pack.completeness_status.ready_for_drafting,
      blocking_issues: pack.completeness_status.blocking_issues,
      skipped,
      locked_skips: lockedSkips,
      contradictions: contradictionsLogged
    },
    completeness_hints: payload.completeness_hints || {},
    round_summary: payload.summary || ""
  }
}];
