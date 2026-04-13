# Completeness Criteria

This document defines the rules for assessing `completeness_status` in the `story_foundation_pack`, and the gates that control when the pack is ready for the next stage of production.

The merge Code node uses these rules to compute `completeness_status` after every round. This replaces subjective AI judgment with deterministic, auditable logic.

---

## Readiness levels

Each section in `completeness_status` uses one of four levels:

| Level | Meaning |
|-------|---------|
| `not_started` | No fields in this section have a `confirmed` value |
| `partial` | At least one field is `confirmed` but required fields are missing |
| `sufficient` | All required fields are `confirmed` — section is ready to support drafting |
| `locked` | Author has explicitly signed off — merge node will not overwrite confirmed fields |

---

## Per-section required fields

These are the minimum fields that must be `confirmed` for a section to reach `sufficient`.

### `project_core`

Required for `sufficient`:
- `premise`
- `genre_primary`
- `hook`

Optional but strongly encouraged:
- `title`
- `format`
- `audience`

### `world_foundation`

Required for `sufficient`:
- `setting_type`
- `major_world_rules` (at least one item)

Optional but strongly encouraged:
- `time_period`
- `primary_location`
- `power_structures`

Note: `magic_or_power_system` is required only if a power system exists. If the author has confirmed there is no magic/power system, this field may remain null with `confirmed` status and an explanatory note.

### `story_engine`

Required for `sufficient`:
- `central_conflict`
- `story_question`
- `stakes`

Optional but strongly encouraged:
- `themes` (at least one item)

### `character_system`

Required for `sufficient`:
- `protagonist.name`
- `protagonist.external_want`
- `protagonist.internal_need`
- `protagonist.wound`
- `antagonist_or_opposing_force.nature`
- `antagonist_or_opposing_force.role_summary`

Optional but strongly encouraged:
- `protagonist.arc_direction`
- `protagonist.voice_notes`
- `antagonist_or_opposing_force.motivation`

### `plot_frame`

Required for `sufficient`:
- `beginning_state`
- `inciting_incident`
- `first_turn`
- `climax`

Optional but strongly encouraged:
- `midpoint`
- `darkest_moment`
- `resolution_shape`

Note: `plot_frame` being `partial` does not block outline stage, but `sufficient` is required before drafting.

### `ending_design`

Required for `sufficient`:
- `ending_summary`
- `emotional_ending_feel`
- `required_payoffs` (at least one item)

Optional but strongly encouraged:
- `protagonist_final_state`
- `final_image`
- `world_state_after`

Note: `ending_design` is treated as a high-priority section. If it is `partial` or lower, the completeness assessment should explicitly flag this in `blocking_issues` even if other sections are `sufficient`.

### `author_preferences`

Required for `sufficient`:
- `pov_preference`
- `prose_register`
- `must_avoid` (at least one item, or a confirmed statement that there are no hard avoids)

Optional but strongly encouraged:
- `tense_preference`
- `chapter_length_target`
- `explicit_inspirations`
- `content_limits`

---

## Overall readiness gates

### `ready_for_outline`

Set to `true` when ALL of the following are true:
- `project_core` is `sufficient` or `locked`
- `story_engine` is `sufficient` or `locked`
- `character_system` is `sufficient` or `locked`
- `plot_frame` is at least `partial`
- `ending_design` is at least `partial` (ending_summary must be confirmed, even tentatively)

### `ready_for_drafting`

Set to `true` when ALL of the following are true:
- `project_core` is `sufficient` or `locked`
- `world_foundation` is `sufficient` or `locked`
- `story_engine` is `sufficient` or `locked`
- `character_system` is `sufficient` or `locked`
- `plot_frame` is `sufficient` or `locked`
- `ending_design` is `sufficient` or `locked`
- `author_preferences` is `sufficient` or `locked`
- No items in `open_questions` have `priority: high` and `resolved: false`

---

## Blocking issues

The `blocking_issues` array in `completeness_status` should contain plain-language descriptions of what specifically is preventing advancement.

Examples:
- `"ending_design.ending_summary is unresolved — no confirmed ending exists"`
- `"character_system.protagonist.internal_need is unresolved — protagonist motivation is unclear"`
- `"3 high-priority open questions remain unresolved"`
- `"Contradiction logged: protagonist described as working alone and also as having a companion — not yet resolved"`

These are surfaced in the next-questions summary so the interview can target them.

---

## How the merge node computes completeness

After applying patches, the Code node runs the following logic for each section:

```
confirmed_required = count of required fields where status == "confirmed"
total_required = total required fields for this section

if confirmed_required == 0:
    level = "not_started"
else if confirmed_required < total_required:
    level = "partial"
else:
    level = "sufficient"
```

It then checks the gate conditions above to set `ready_for_outline` and `ready_for_drafting`.

It also scans for unresolved contradictions and high-priority open questions and populates `blocking_issues`.

The `locked` level is never set automatically. It can only be set by a human explicitly writing `"locked"` into the pack, or by a dedicated approval step in the n8n workflow.

---

## Completeness vs quality

This criteria document only measures structural completeness — whether required fields are confirmed. It does not measure quality.

A `sufficient` premise might still be weak. A `confirmed` ending might still be unconvincing.

That is intentional. Quality assessment happens in Step 3 critique passes, not here. The foundation processor's job is to track what is known, not to judge whether what is known is good.
