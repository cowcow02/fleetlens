# Fleetlens — Day-first pattern detection design

**Status:** Draft, ready for implementation
**Date:** 2026-04-29
**Author:** Brainstormed with user 2026-04-29
**Ships:** Single PR landing all three layers (Entry signals + DayDigest day_signals + WeekDigest pure-aggregation refactor) plus prompt + renderer + tests
**Depends on:** PR #26 (commits `0af02aa` … `708dc6c`) on `feat/v2-final-pass`
**Coexists with:** Old cached digests — additive schema, fallback on read, auto-regenerate on next visit

---

## Overview

Move pattern detection from the week-aggregation layer down to the Entry-build and day-digest layers. The Entry stops being a passive data carrier and starts emitting deterministic `signals` (working_shape, prompt_frames, subagent_roles, verbosity, external_refs, brainstorm_warmup, continuation_kind). The DayDigest aggregates per-Entry signals into a day-level classification (`day_signals`) and produces a single `day_signature` line characterizing the day. The WeekDigest reads only DayDigests — no more reach-around to raw entries — and writes its narrative by quoting `day_signature` strings and aggregating per-day classifications.

Result: the day digest reader sees their day's shape at a glance; the week LLM aggregates pre-classified days instead of re-deriving from entries; the spec's strict hierarchy (Entry → Day → Week → Month) is honored throughout; month-level work in the future is pure rollup.

## Why now

PR #26 added `WeekDigest.working_shapes` + `WeekDigest.interaction_grammar` by reaching past DayDigest into raw entries (`buildDeterministicWeekDigest(monday, dayDigests, { entries })`). That works but it:

1. Violates the spec's strict-hierarchy rule (each layer talks only to the one below).
2. Leaves the day digest analytically thin — the reader can't see "today was a spec-review-loop day" until they read the prose narrative.
3. Forces the week LLM to reconcile two parallel signal sources (deterministic shapes from entries + LLM prose from day digests). When they don't align, the week prose drifts.
4. Pre-commits the same architectural bug for MonthDigest later.

This refactor fixes all four in one move.

## Vocabulary (no new terms)

The terms `Entry`, `DayDigest`, `WeekDigest`, `MonthDigest` stay. `WorkingShape`, `SubagentRole`, `PromptFrame`, `SkillOrigin` stay. The `working_shapes` and `interaction_grammar` rollups on WeekDigest stay (now sourced from day-level data).

New named field: **`day_signals`** on DayDigest — the per-day analogue of `interaction_grammar`. New named field: **`day_signature`** — one short LLM-produced line per day characterizing its shape. Both names lock in.

## Architecture (target)

```
Entry           numbers + LLM enrichment + signals (NEW: deterministic, per-Entry)
   │
   ├─ DayDigest day_signals (NEW: aggregates Entry.signals across the day)
   │            day_signature (NEW: one LLM line characterizing the day)
   │            existing narrative fields (anchored to day_signals.dominant_shape)
   │
   └─ WeekDigest reads ONLY DayDigests (no `entries` param)
                  working_shapes ← aggregates dayDigests[].day_signals.shape_distribution
                  interaction_grammar ← aggregates dayDigests[].day_signals.{...}
                  skill_families + threads stay at week level (inherently cross-day)
                  LLM input becomes per-day signatures + aggregated rollups
```

## Data model

### Entry.signals (NEW, additive)

```ts
// packages/entries/src/types.ts
export type EntrySignals = {
  /** Session shape inferred from subagent dispatches + first_user + skills. */
  working_shape: WorkingShape | null;
  /** Prompt frames detected on first_user. */
  prompt_frames: PromptFrame[];
  /** Role per dispatched subagent, parallel to entry.subagents[]. */
  subagent_roles: SubagentRole[];
  /** Length bucket of first_user. */
  verbosity: "short" | "medium" | "long" | "very_long";
  /** External-system references parsed out of first_user (ORB-N, issue#N, etc.). */
  external_refs: Array<{ kind: ExternalRefKind; preview: string }>;
  /** Did this session open with a brainstorming/writing-plans skill load? */
  brainstorm_warmup: boolean;
  /** Was this session a continuation? */
  continuation_kind: "none" | "literal-continue" | "handoff-prose";
};

export type ExternalRefKind = "ticket-ref" | "github-issue-pr" | "branch-ref" | "url";

export type Entry = {
  ...existing,
  signals?: EntrySignals;   // optional for backward compat with cached entries
};
```

**Source of truth:** all classifiers (currently in `packages/entries/src/digest-week.ts`) move into a new `packages/entries/src/signals.ts`. The week-level versions become thin re-exports for backward compat with old cached entries that lack `signals`.

**Computed at Entry-build time** in `packages/entries/src/build.ts` (the deterministic Entry builder). Cheap — no LLM call.

### DayDigest.day_signals + day_signature (NEW, additive)

```ts
// packages/entries/src/types.ts
export type DaySignals = {
  /** Dominant shape across the day, weighted by active_min. "mixed" when no
   *  single entry exceeds 60% of the day's active_min. null on trivial days. */
  dominant_shape: WorkingShape | "mixed" | null;
  /** Per-shape session count for the day. */
  shape_distribution: Partial<Record<NonNullable<WorkingShape>, number>>;

  /** Skills loaded today, with origin classification. */
  skills_loaded: Array<{ skill: string; origin: SkillOrigin; count: number }>;
  /** User-authored skill names (bare); the week aggregates families. */
  user_authored_skills_used: string[];
  /** User-authored Task subagent types dispatched today, with sample evidence. */
  user_authored_subagents_used: Array<{
    type: string;
    count: number;
    sample_description: string;
    sample_prompt_preview: string;
  }>;

  /** Prompt frames detected today, with origin labels. */
  prompt_frames: Array<{
    frame: PromptFrame;
    origin: "claude-feature" | "personal-habit";
    count: number;
  }>;

  /** Communication style for the day. */
  comm_style: {
    verbosity_distribution: { short: number; medium: number; long: number; very_long: number };
    external_refs: Array<{ session_id: string; kind: ExternalRefKind; preview: string }>;
    steering: {
      interrupts: number;
      frustrated: number;
      dissatisfied: number;
      sessions_with_mid_run_redirect: number;
    };
  };

  /** Number of sessions that opened with a brainstorming/writing-plans skill. */
  brainstorm_warmup_session_count: number;
  todo_ops_total: number;
  /** Any entry today had exit_plan_calls > 0 or plan_used flag. */
  plan_mode_used: boolean;
};

export type DayDigest = ...envelope & {
  ...existing,
  /** Deterministic per-day classification. Optional for backward compat. */
  day_signals?: DaySignals;
  /** One LLM-produced line characterizing the day's shape — quotable by the
   *  week digest. Optional, null when ai_features.enabled === false or
   *  synth declined. */
  day_signature?: string | null;
};
```

### WeekDigest changes

The `working_shapes`, `interaction_grammar`, and 4 narrative buckets shapes stay (no schema change). What changes is *how they're computed*:

- `buildDeterministicWeekDigest` drops the `opts.entries` parameter.
- `working_shapes` is now aggregated from `dayDigests[].day_signals.shape_distribution`. For each shape that occurred, build the occurrence list from days where that shape appeared (using the day's representative entry — pulled by reading `entries` from disk only when needed for evidence-quote backfill, not for re-derivation).
- `interaction_grammar` is aggregated from `dayDigests[].day_signals.{skills_loaded, user_authored_skills_used, user_authored_subagents_used, prompt_frames, comm_style, brainstorm_warmup_session_count, todo_ops_total, plan_mode_used}`.
- `skill_families` (cross-day rollup of user-authored skills by prefix) and `threads` (multi-day session continuity) stay at week level — they're inherently cross-day signals.

The week LLM **input payload** becomes substantially smaller and pre-classified:

```ts
// User prompt structure
{
  period: {...},
  totals: {...},
  outcome_mix: {...},
  helpfulness_sparkline: [...],
  projects: [...],
  shipped: [...],
  top_flags: [...],
  top_goal_categories: [...],
  // NEW per-day input — replaces re-deriving shapes from raw entries
  day_summaries: [
    {
      date: "YYYY-MM-DD",
      day_name: "Wed",
      headline, what_went_well, what_hit_friction, suggestion,  // existing
      day_signature,                                              // NEW
      dominant_shape,                                             // NEW
      shape_distribution: { ... },                                // NEW
      day_signals_summary: { ... }                                // NEW (compact)
    },
    ...
  ],
  // Aggregated rollups (week-level)
  working_shapes: [...],            // sourced from day_signals
  interaction_grammar: {            // sourced from day_signals + cross-day rollups
    skill_families,
    threads,
    ... (other fields aggregated from days)
  },
  flag_glossary: [...],
  valid_anchors: { ... }
}
```

## Per-Entry signal computation

Move + consolidate existing classifiers into `packages/entries/src/signals.ts`:

```ts
// packages/entries/src/signals.ts
import type { Entry, EntrySubagent, EntrySignals, SubagentRole, PromptFrame, ExternalRefKind, WorkingShape } from "./types.js";

export function classifySubagentRole(sa: EntrySubagent): SubagentRole;     // existing logic
export function isStockSubagentType(type: string): boolean;                // existing logic
export function detectPromptFrames(text: string | null | undefined): PromptFrame[];  // existing logic
export function classifySkill(name: string): SkillOrigin;                  // existing logic
export function inferWorkingShape(entry: Entry): WorkingShape | null;      // existing logic
export function detectExternalRef(text: string | null | undefined): { kind: ExternalRefKind; preview: string } | null;  // existing logic

/** NEW — produce the full Entry.signals object from an Entry.
 *  This is the canonical computation; called at Entry-build time. */
export function computeEntrySignals(entry: Entry): EntrySignals {
  const fu = entry.first_user || "";
  const fuLen = fu.length;
  const verbosity =
    fuLen < 100 ? "short" :
    fuLen < 500 ? "medium" :
    fuLen < 2000 ? "long" : "very_long";

  const ext = detectExternalRef(fu);
  const external_refs = ext ? [ext] : [];

  const skillNames = Object.keys(entry.skills ?? {});
  const brainstorm_warmup = skillNames.some(s => /brainstorm|writing-plans/i.test(s));

  const fuTrim = fu.trim().toLowerCase();
  const continuation_kind: EntrySignals["continuation_kind"] =
    /^continue\b/.test(fuTrim) ? "literal-continue" :
    detectPromptFrames(fu).includes("handoff-prose") ? "handoff-prose" :
    "none";

  return {
    working_shape: inferWorkingShape(entry),
    prompt_frames: detectPromptFrames(fu),
    subagent_roles: (entry.subagents ?? []).map(classifySubagentRole),
    verbosity,
    external_refs,
    brainstorm_warmup,
    continuation_kind,
  };
}
```

**Wire into Entry build:** `packages/entries/src/build.ts` — after the existing deterministic Entry construction, populate `entry.signals = computeEntrySignals(entry)`.

**Backward compat:** when reading an Entry without `signals` (cached pre-refactor), the consumers in DayDigest aggregation fall back to calling `computeEntrySignals(entry)` on the fly. No mass regeneration needed.

## Day digest aggregation

`packages/entries/src/digest-day.ts` — `buildDeterministicDayDigest`:

After the existing aggregations, compute `day_signals`:

```ts
import { computeEntrySignals, classifySkill, isStockSubagentType, PROMPT_FRAME_ORIGIN } from "./signals.js";

function computeDaySignals(entries: Entry[]): DaySignals {
  // Get signals (either from entry.signals or freshly computed)
  const signalsList = entries.map(e => e.signals ?? computeEntrySignals(e));

  // Dominant shape — weighted by active_min, "mixed" when no entry > 60%.
  const totalMin = entries.reduce((s, e) => s + e.numbers.active_min, 0);
  const shapeMinutes = new Map<WorkingShape, number>();
  for (let i = 0; i < entries.length; i++) {
    const s = signalsList[i]!.working_shape;
    if (!s) continue;
    shapeMinutes.set(s, (shapeMinutes.get(s) ?? 0) + entries[i]!.numbers.active_min);
  }
  let dominant_shape: DaySignals["dominant_shape"] = null;
  if (shapeMinutes.size > 0 && totalMin > 0) {
    const [topShape, topMin] = [...shapeMinutes.entries()].sort((a, b) => b[1] - a[1])[0]!;
    dominant_shape = (topMin / totalMin) >= 0.6 ? topShape : "mixed";
  }

  const shape_distribution: Partial<Record<NonNullable<WorkingShape>, number>> = {};
  for (const s of signalsList) {
    if (!s.working_shape) continue;
    shape_distribution[s.working_shape] = (shape_distribution[s.working_shape] ?? 0) + 1;
  }

  // ... (skills, subagents, prompt_frames, comm_style aggregations follow the
  //      same pattern as today's WeekInteractionGrammar code, but per-day)

  return { dominant_shape, shape_distribution, ... };
}
```

The `day_signature` is filled by the day-digest LLM call (see prompt section below).

## Day digest prompt

`packages/entries/src/prompts/digest-day.ts` — extend the user prompt to include `day_signals` and ask for `day_signature`:

```ts
// Add to user payload
{
  ...existing fields,
  day_signals: {
    dominant_shape, shape_distribution,
    skills_loaded, user_authored_skills_used, user_authored_subagents_used,
    prompt_frames, comm_style, brainstorm_warmup_session_count,
    todo_ops_total, plan_mode_used,
  },
}
```

System prompt additions:

```
You now also receive `day_signals` — a deterministic classification of how the user worked today. Treat it as the analytical foundation; your narrative anchors here.

OUTPUT (extends existing schema):
{
  ...existing fields,
  "day_signature": "≤120 chars; one sentence characterizing today's shape that the week digest can quote verbatim. Format: '<shape> on <project>: <key signal>, <outcome>'. Examples:
    - 'spec-review-loop on Phase 1b: 3 reviewers + 1 implementer, shipped clean'
    - 'solo-build with mid-run redirect: ConnectionRefused at minute 70'
    - 'research-then-build: 3 Explore subagents, ahora v8 spec drafted'
    - 'mixed: 2 spec-review-loop + 1 chunk-implementation, all shipped'
   Null only when day_signals.dominant_shape is null (trivial day)."
}

ANCHORING (extends existing rules):
  Every what_went_well / what_hit_friction / suggestion MUST cite either:
    - day_signals.dominant_shape value, OR
    - "day_signals.<key>" where key is shape_distribution / comm_style / user_authored_skills / user_authored_subagents / prompt_frames / plan_mode_used / brainstorm_warmup
  When the day has only one session, anchor to its signals.working_shape.
```

## Day digest renderer

`apps/web/components/day-digest.tsx` — add a "How today worked" section directly under the headline (above the existing narrative prose):

```tsx
{digest.day_signals && (
  <DaySignalsSection signals={digest.day_signals} signature={digest.day_signature} />
)}
```

The section renders:
- Dominant-shape badge (with the shape name from `SHAPE_LABELS`)
- Shape distribution chips ("2 spec-review-loop · 1 chunk-implementation")
- Subagent role counts ("3 reviewers, 1 implementer, 1 explorer")
- Skills loaded — split into stock vs user-authored
- User-authored subagents (with sample prompt preview if any)
- Prompt frames detected (Claude features vs personal habits)
- Comm style indicators (verbosity histogram, external refs count, steering count)
- Brainstorm warmup / Plan Mode usage
- The `day_signature` line as italic subhead under the headline if present

The narrative fields (what_went_well, what_hit_friction, suggestion) gain anchor chips matching the week renderer's pattern.

## Week digest builder

`packages/entries/src/digest-week.ts`:

1. Drop `opts.entries` from `BuildDeterministicWeekOptions` and from the call site (`runWeekDigestPipeline`). The pipeline still loads entries for `longest_run` and `hours_distribution` (those need per-Entry data) but nothing else reaches into entries.

2. `computeWorkingShapes(entries, dayDigests)` becomes `computeWorkingShapes(dayDigests)`. Walks `dayDigests[].day_signals.shape_distribution` to build the per-shape occurrence list. Evidence subagent + first_user are still pulled from entries (for the renderer), but only for representative samples — not for shape detection.

3. `computeInteractionGrammar(entries)` becomes `computeInteractionGrammar(dayDigests)`. Aggregates each field by union/sum across `dayDigests[].day_signals.*`. `skill_families` and `threads` stay (cross-day inherently).

4. Backward-compat fallback: when a DayDigest in the input lacks `day_signals` (cached pre-refactor), call `computeDaySignalsFromEntries(entriesForDay)` on the fly. This preserves the renderer experience for old digests until they're re-rolled.

## Week digest prompt

`packages/entries/src/prompts/digest-week.ts` — `buildWeekDigestUserPrompt`:

The user payload now passes per-day `day_signature` + `dominant_shape` + a compact `day_signals_summary` per day, sized so the prompt is materially smaller than today's. The system prompt's NARRATIVE FLOW section gets one new instruction:

```
[2.5] You can quote `day_signature` strings directly when introducing a day's
work. They're concise classifications already grounded in the day's data —
quoting them strengthens the narrative without adding length.
```

The 4 narrative buckets (`what_worked` / `what_stalled` / `what_surprised` / `where_to_lean`) keep their anchor system. The valid anchors list now includes day-level anchors (e.g. `day_signals.dominant_shape`) in addition to the existing week-level anchors.

## Week digest renderer

Minimal changes — the renderer mostly already consumes `WeekInteractionGrammar` which doesn't change shape. Two additions:

1. The `<WorkingShapesSection>` per-shape card can now show the per-occurrence `day_signature` as the evidence line (instead of just the subagent prompt preview), since each occurrence is a day rather than a session-within-day. More readable.

2. The `<DaysActiveBars>` component gains a small shape-color stripe per day showing `dominant_shape` — a visual cue that complements the existing outcome-color bars.

## Migration / fallback

Schema stays at v2. All new fields are optional. The system upgrades naturally:

- **Old cached entries** (no `signals`): consumed by DayDigest aggregation via `computeEntrySignals(entry)` fallback. Zero re-roll required.
- **Old cached day digests** (no `day_signals` / `day_signature`): renderer falls back to legacy view. WeekDigest aggregation falls back to per-Entry computation for those days. Re-rolling the day populates the new fields.
- **Old cached week digests**: re-roll picks up the new shape. The renderer's `LegacyNarrativeFallback` notice (already shipped in PR #26) prompts the user.

No data migration script. No daemon changes. Cached digests upgrade lazily as the user navigates / re-rolls.

## Testing strategy

**Unit (`packages/entries/test/`):**
- `signals.test.ts` — fixture Entries → expected `signals` object. Cover all classifiers (working_shape per shape, prompt_frames per frame, role per role, verbosity buckets, external_refs by kind, brainstorm_warmup, continuation_kind).
- `digest-day-signals.test.ts` — fixture entries → expected `day_signals` (dominant_shape, shape_distribution, comm_style aggregations, frames union).
- `digest-day-generate.test.ts` — extend existing test: VALID_RESPONSE includes `day_signature`. Verify pruning still works on what_hit_friction quotes.
- `digest-week.test.ts` — exercise the path where dayDigests carry `day_signals`. Then exercise the fallback path where they don't.

**CLI parity:**
- `fleetlens digest day --json` includes `day_signals` + `day_signature` for new digests.
- `fleetlens digest week --json` builds correctly from day-level data.

**Smoke (`scripts/smoke.mjs`):**
- `/digest/yesterday` returns 200 (existing test).
- `/insights` returns 200 (existing test).
- Visual smoke: render both layers post-regen and confirm the "How today worked" section + week digest's per-day shape stripe.

## Rollout

**Single PR.** Three logically distinct parts but no point splitting them — they only become useful together (the day signals are dead weight without the day prompt + renderer; the week refactor needs day_signals to land first).

Order of changes within the PR (for the implementing agent's benefit):

1. Add types: `EntrySignals`, `ExternalRefKind`, `DaySignals`, plus optional fields on `Entry` and `DayDigest`.
2. Create `packages/entries/src/signals.ts` consolidating classifiers + `computeEntrySignals`.
3. Wire signals computation into Entry build (`packages/entries/src/build.ts`).
4. Add `computeDaySignals` to `digest-day.ts`; wire into `buildDeterministicDayDigest`.
5. Update day digest prompt to include `day_signals` input + `day_signature` output + anchor rules.
6. Update day digest renderer with `<DaySignalsSection>`.
7. Refactor `digest-week.ts`: drop `entries` from builder; aggregate from dayDigests; backward-compat fallback for old digests.
8. Update week digest prompt's user payload to include per-day signatures + structured signals.
9. Tweak week digest renderer (per-occurrence day_signature evidence line + DaysActiveBars shape stripe).
10. Tests + smoke.

Verify after each step that typecheck + tests pass. Visual smoke at the end.

## CLI command surface

No new commands. `fleetlens digest day` / `fleetlens digest week` continue to work; the `--json` output now includes the new fields when generated under the new code.

## Privacy / cost

- All Entry-level classifiers are deterministic (regex + counting). No LLM call added.
- `day_signature` is one extra field in the existing day-digest LLM call. Marginal cost — < $0.001 per call.
- Week digest LLM call gets a smaller input payload. Marginal *savings* expected.
- No new data sent externally. Same privacy posture as PR #26.

## Out of scope

- MonthDigest changes — the architectural fix flows up naturally; explicit MonthDigest work is a follow-up.
- Project-scoped digests, streak detection, personal playbook view — all enabled by this refactor but not implemented here.
- Schema version bump (stays at v2).
- Daemon changes (deterministic-only path is unaffected).
- The selfhosted feature work (separate track).

## Open questions (resolved)

1. **One PR or three?** One. The three parts only become useful together; no value in shipping intermediate states.
2. **Day signature line — keep, or skip?** Keep. The week LLM benefits from quotable per-day strings, and the cost is one field in an existing LLM call.
3. **Cached digest fallback?** Auto-regenerate-friendly — cached old-shape digests render with the legacy renderer; re-roll picks up the new shape. No explicit "click to upgrade" prompts.
4. **Schema version bump?** No. Additive optional fields, stays v2.

---

**Next step after sign-off:** open a fresh session in `.worktrees/day-first/` (a new worktree branched off `feat/v2-final-pass`), point that session at this spec, and execute end-to-end. The handoff prompt below is what to paste.
