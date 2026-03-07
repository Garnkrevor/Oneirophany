/**
 * Step 2 — Merge Code Node
 *
 * This is the canonical merge logic for the story_foundation_pack.
 * It runs as a Code node in n8n.
 *
 * Inputs (from previous node):
 *   $input.first().json = { payload, current_pack, round_label }
 *
 *   payload:      foundation_update_payload object (parsed, validated)
 *   current_pack: story_foundation_pack object (loaded from JSON master)
 *   round_label:  string, e.g. "Pass 1 - Concept"
 *
 * Output:
 *   updated story_foundation_pack object
 *
 * Rules:
 *   - Model extracts. This node governs canon.
 *   - Never overwrite a "confirmed" field unless merge_rule is "overwrite".
 *   - Never touch any field in a "locked" section.
 *   - Contradictions are logged, not auto-resolved.
 *   - Changelog is append-only.
 */

const input = $input.first().json;
const payload = input.payload;
const pack = JSON.parse(JSON.stringify(input.current_pack)); // deep clone
const roundLabel = input.round_label || "Unspecified round";
const now = new Date().toISOString();

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve a dot-path string to a nested object reference.
 * Returns { parent, key } so the caller can read or write the field.
 * Returns null if the path is invalid.
 */
function resolvePath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== "object") return null;
    current = current[parts[i]];
  }
  if (current == null || typeof current !== "object") return null;
  return { parent: current, key: parts[parts.length - 1] };
}

/**
 * Get the current status of a field at a given path.
 * Returns null if field doesn't exist.
 */
function getFieldStatus(obj, path) {
  const ref = resolvePath(obj, path);
  if (!ref) return null;
  const field = ref.parent[ref.key];
  if (field == null || typeof field !== "object") return null;
  return field.status || null;
}

/**
 * Get the top-level section name from a dot-path.
 * e.g. "character_system.protagonist.name" -> "character_system"
 */
function getSectionName(path) {
  return path.split(".")[0];
}

/**
 * Check whether a section is locked.
 * A section is locked if completeness_status[section] === "locked".
 */
function isSectionLocked(pack, sectionName) {
  const status = pack.completeness_status;
  if (!status) return false;
  return status[sectionName] === "locked";
}

// ─── Tracking ────────────────────────────────────────────────────────────────

let patchesApplied = 0;
const skippedPatches = [];
const lockedSkips = [];
const contradictionsLogged = [];
const newOpenQuestions = [];

// ─── Apply Patches ───────────────────────────────────────────────────────────

for (const patch of payload.patches || []) {
  const { path, value, status, notes, merge_rule } = patch;
  const rule = merge_rule || "skip_if_confirmed";

  const sectionName = getSectionName(path);

  // Hard stop: never touch locked sections
  if (isSectionLocked(pack, sectionName)) {
    lockedSkips.push({ path, reason: `Section "${sectionName}" is locked` });
    continue;
  }

  const ref = resolvePath(pack, path);

  if (!ref) {
    // Path doesn't exist in the pack — could be a schema mismatch or new field
    // Log it but don't crash
    skippedPatches.push({ path, reason: "Path not found in pack" });
    continue;
  }

  const currentField = ref.parent[ref.key];
  const currentStatus = currentField && currentField.status ? currentField.status : "unresolved";

  // skip_if_confirmed: do not overwrite confirmed fields
  if (rule === "skip_if_confirmed" && currentStatus === "confirmed") {
    skippedPatches.push({
      path,
      reason: `Field is confirmed, merge_rule is skip_if_confirmed`
    });
    continue;
  }

  // append: for array fields, merge new items without removing existing
  if (rule === "append") {
    const existing = currentField && Array.isArray(currentField.value) ? currentField.value : [];
    const incoming = Array.isArray(value) ? value : (value ? [value] : []);
    const merged = Array.from(new Set([...existing, ...incoming]));
    ref.parent[ref.key] = {
      value: merged,
      status: status,
      ...(notes ? { notes } : {}),
      set_in_version: (pack.version || 0) + 1
    };
    patchesApplied++;
    continue;
  }

  // overwrite or skip_if_confirmed (where field is not confirmed): apply normally
  ref.parent[ref.key] = {
    value: value,
    status: status,
    ...(notes ? { notes } : {}),
    set_in_version: (pack.version || 0) + 1
  };
  patchesApplied++;
}

// ─── Log Contradictions ──────────────────────────────────────────────────────

for (const contradiction of payload.contradictions || []) {
  // Do not auto-resolve. Log for human review.
  contradictionsLogged.push(contradiction);
}

// ─── Add Open Questions ──────────────────────────────────────────────────────

let nextOqId = (pack.open_questions || []).length + 1;

for (const oq of payload.open_questions || []) {
  const id = `oq_${String(nextOqId).padStart(3, "0")}`;
  newOpenQuestions.push({
    id,
    question: oq.question,
    section: oq.section,
    priority: oq.priority,
    added_in_version: (pack.version || 0) + 1,
    resolved: false
  });
  nextOqId++;
}

if (!pack.open_questions) pack.open_questions = [];
pack.open_questions.push(...newOpenQuestions);

// ─── Compute Completeness ────────────────────────────────────────────────────

/**
 * Required fields per section (must be "confirmed" for section to be "sufficient").
 * Arrays count as sufficient if they have at least 1 confirmed item.
 */
const REQUIRED_FIELDS = {
  project_core: [
    "project_core.premise",
    "project_core.genre",
    "project_core.hook"
  ],
  world_foundation: [
    "world_foundation.setting_type",
    "world_foundation.major_world_rules"
  ],
  story_engine: [
    "story_engine.central_conflict",
    "story_engine.story_question",
    "story_engine.stakes"
  ],
  character_system: [
    "character_system.protagonist.name",
    "character_system.protagonist.external_want",
    "character_system.protagonist.internal_need",
    "character_system.protagonist.wound",
    "character_system.antagonist_or_opposing_force.nature",
    "character_system.antagonist_or_opposing_force.role_summary"
  ],
  plot_frame: [
    "plot_frame.beginning_state",
    "plot_frame.inciting_incident",
    "plot_frame.first_turn",
    "plot_frame.climax"
  ],
  ending_design: [
    "ending_design.ending_summary",
    "ending_design.emotional_ending_feel",
    "ending_design.required_payoffs"
  ],
  author_preferences: [
    "author_preferences.pov_preference",
    "author_preferences.prose_register"
  ]
};

function assessSection(pack, sectionName) {
  const current = pack.completeness_status[sectionName];
  if (current === "locked") return "locked"; // never downgrade a locked section

  const required = REQUIRED_FIELDS[sectionName] || [];
  let confirmedCount = 0;

  for (const fieldPath of required) {
    const ref = resolvePath(pack, fieldPath);
    if (!ref) continue;
    const field = ref.parent[ref.key];
    if (!field) continue;

    // For array fields, confirmed means status is confirmed AND value has at least 1 item
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

function computeCompleteness(pack) {
  const sections = Object.keys(REQUIRED_FIELDS);
  const newStatus = { ...pack.completeness_status };
  const blockingIssues = [];

  for (const section of sections) {
    newStatus[section] = assessSection(pack, section);
  }

  // Compute overall
  const levels = sections.map(s => newStatus[s]);
  if (levels.every(l => l === "not_started")) {
    newStatus.overall = "not_started";
  } else if (levels.every(l => l === "sufficient" || l === "locked")) {
    newStatus.overall = "sufficient";
  } else {
    newStatus.overall = "partial";
  }

  // Gate: ready_for_outline
  const outlineReady =
    (newStatus.project_core === "sufficient" || newStatus.project_core === "locked") &&
    (newStatus.story_engine === "sufficient" || newStatus.story_engine === "locked") &&
    (newStatus.character_system === "sufficient" || newStatus.character_system === "locked") &&
    (newStatus.plot_frame === "partial" || newStatus.plot_frame === "sufficient" || newStatus.plot_frame === "locked") &&
    (newStatus.ending_design === "partial" || newStatus.ending_design === "sufficient" || newStatus.ending_design === "locked");

  // Gate: ready_for_drafting
  const unresolvedHighPriority = (pack.open_questions || []).filter(
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

  // Blocking issues
  if (!outlineReady) {
    for (const section of ["project_core", "story_engine", "character_system"]) {
      if (newStatus[section] !== "sufficient" && newStatus[section] !== "locked") {
        blockingIssues.push(`${section} is ${newStatus[section]} — required for outline`);
      }
    }
    if (!["partial", "sufficient", "locked"].includes(newStatus.ending_design)) {
      blockingIssues.push("ending_design has no confirmed content — at least ending_summary is required");
    }
  }

  if (!draftingReady && outlineReady) {
    for (const section of ["world_foundation", "plot_frame", "ending_design", "author_preferences"]) {
      if (newStatus[section] !== "sufficient" && newStatus[section] !== "locked") {
        blockingIssues.push(`${section} is ${newStatus[section]} — required for drafting`);
      }
    }
    if (unresolvedHighPriority > 0) {
      blockingIssues.push(`${unresolvedHighPriority} high-priority open question(s) remain unresolved`);
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

pack.completeness_status = computeCompleteness(pack);

// ─── Version and Changelog ───────────────────────────────────────────────────

const previousVersion = pack.version || 0;
pack.version = previousVersion + 1;
pack.last_modified = now;

if (!pack.changelog) pack.changelog = [];
pack.changelog.push({
  version: pack.version,
  timestamp: now,
  round_label: roundLabel,
  summary: payload.summary || "No summary provided.",
  patches_applied: patchesApplied
});

// ─── Output ──────────────────────────────────────────────────────────────────

return [{
  json: {
    updated_pack: pack,
    merge_report: {
      version: pack.version,
      patches_applied: patchesApplied,
      patches_skipped: skippedPatches.length,
      locked_skips: lockedSkips.length,
      contradictions_logged: contradictionsLogged.length,
      new_open_questions: newOpenQuestions.length,
      ready_for_outline: pack.completeness_status.ready_for_outline,
      ready_for_drafting: pack.completeness_status.ready_for_drafting,
      blocking_issues: pack.completeness_status.blocking_issues,
      skipped_patches: skippedPatches,
      locked_skips: lockedSkips,
      contradictions: contradictionsLogged
    },
    suggested_next_questions: payload.suggested_next_questions || [],
    round_summary: payload.summary || ""
  }
}];
