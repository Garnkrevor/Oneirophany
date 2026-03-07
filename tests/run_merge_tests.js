#!/usr/bin/env node
/**
 * Merge Code Test Harness
 *
 * Loads n8n/merge_code_node.js directly and runs it against fixture payloads
 * using a mocked $input. Tests the actual merge code with no duplication.
 *
 * Usage:
 *   node tests/run_merge_tests.js
 *
 * Exit code: 0 = all pass, 1 = any failure.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MERGE_CODE = fs.readFileSync(path.join(ROOT, "n8n/merge_code_node.js"), "utf-8");
const TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(ROOT, "schemas/story_foundation_pack.template.json"), "utf-8")
);

// ─── Merge runner ─────────────────────────────────────────────────────────────
//
// Wraps the n8n Code node in a Function with $input mocked.
// The merge code ends with `return [{ json: ... }]`, which is valid here.

function runMerge(currentPack, payload) {
  const inputData = { payload, current_pack: currentPack };
  const $input = { first: () => ({ json: inputData }) };

  // new Function creates a function whose body is the merge code.
  // $input is passed as the only parameter.
  const mergeFn = new Function("$input", MERGE_CODE);
  const result = mergeFn($input);
  return result[0].json;
}

// ─── Path resolver for nested pack fields ─────────────────────────────────────

function getNestedValue(obj, dotPath) {
  return dotPath.split(".").reduce((cur, key) => {
    if (cur == null) return undefined;
    return cur[key];
  }, obj);
}

// ─── Check helper ─────────────────────────────────────────────────────────────

function check(label, actual, expectedVal) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expectedVal);
  if (actualStr === expectedStr) {
    console.log(`    PASS  ${label} = ${actualStr}`);
    return true;
  } else {
    console.log(`    FAIL  ${label}`);
    console.log(`          expected: ${expectedStr}`);
    console.log(`          got:      ${actualStr}`);
    return false;
  }
}

// ─── Load fixtures ────────────────────────────────────────────────────────────

const fixturesDir = path.join(__dirname, "fixtures");
const fixtureFiles = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

let passed = 0;
let failed = 0;

console.log(`\nRunning ${fixtureFiles.length} fixture(s) against merge_code_node.js\n`);

for (const fixtureName of fixtureFiles) {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, fixtureName), "utf-8")
  );

  console.log(`─── ${fixtureName}`);
  console.log(`    ${fixture.description}`);

  // Use template if starting_pack is null
  const startingPack = fixture.starting_pack
    ? JSON.parse(JSON.stringify(fixture.starting_pack))
    : JSON.parse(JSON.stringify(TEMPLATE));

  let result;
  try {
    result = runMerge(startingPack, fixture.payload);
  } catch (err) {
    console.log(`    ERROR  ${err.message}`);
    console.log(`           ${err.stack.split("\n")[1] || ""}`);
    failed++;
    console.log();
    continue;
  }

  const report = result.merge_report;
  const pack = result.updated_pack;
  const exp = fixture.expected;
  let allPassed = true;

  if ("pack_version" in exp) {
    allPassed = check("pack.version", pack.version, exp.pack_version) && allPassed;
  }
  if ("updates_applied" in exp) {
    allPassed = check("updates_applied", report.updates_applied, exp.updates_applied) && allPassed;
  }
  if ("contradictions_logged" in exp) {
    allPassed = check("contradictions_logged", report.contradictions_logged, exp.contradictions_logged) && allPassed;
  }
  if ("new_open_questions" in exp) {
    allPassed = check("new_open_questions", report.new_open_questions, exp.new_open_questions) && allPassed;
  }
  if ("ready_for_outline" in exp) {
    allPassed = check("ready_for_outline", pack.completeness_status.ready_for_outline, exp.ready_for_outline) && allPassed;
  }
  if ("ready_for_drafting" in exp) {
    allPassed = check("ready_for_drafting", pack.completeness_status.ready_for_drafting, exp.ready_for_drafting) && allPassed;
  }

  // field_not_overwritten: assert that a specific pack field still holds a prior value
  if (exp.field_not_overwritten) {
    const { path: fieldPath, value: expectedValue } = exp.field_not_overwritten;
    const fieldObj = getNestedValue(pack, fieldPath);
    const actual = fieldObj ? fieldObj.value : undefined;
    allPassed = check(`field_not_overwritten (${fieldPath})`, actual, expectedValue) && allPassed;
  }

  // field_value: assert that a specific pack field now holds a given value
  if (exp.field_value) {
    const { path: fieldPath, value: expectedValue } = exp.field_value;
    const fieldObj = getNestedValue(pack, fieldPath);
    const actual = fieldObj ? fieldObj.value : undefined;
    allPassed = check(`field_value (${fieldPath})`, actual, expectedValue) && allPassed;
  }

  if (allPassed) {
    passed++;
  } else {
    failed++;
  }
  console.log();
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`═══════════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════\n`);

process.exit(failed > 0 ? 1 : 0);
