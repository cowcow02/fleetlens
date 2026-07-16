# Proposal — push pattern detection down to the day digest

**Status:** proposal, awaiting sign-off before implementation.
**Premise:** the capsule (Entry) is where the raw user-input + skills + subagent signal is richest. The day digest is the right layer to *classify* what kind of day this was. The week digest should aggregate already-classified day-level signals, not re-derive from raw entries.

---

## Where we are now

The current architecture (commits `0af02aa` through `708dc6c`):

```
Entry              numbers + flags + skills + subagents + first_user + LLM enrichment
   │
   ├─ DayDigest    LLM headline/narrative/what_went_well/what_hit_friction/suggestion
   │                 + deterministic projects/shipped/top_flags/top_goal_categories
   │                 ⚠ NO working_shape, NO interaction grammar, NO comm style
   │
   └─ WeekDigest   pulls Entry[] (reaches PAST DayDigest)
                     computes working_shapes from per-Entry subagent sequences
                     computes interaction_grammar from per-Entry first_user + skills
                     LLM produces what_worked/what_stalled/what_surprised/where_to_lean
```

**The problems:**

1. **Strict hierarchy violation.** The spec (`docs/superpowers/specs/2026-04-22-perception-layer-design.md`) is explicit: each layer talks only to the one below. The week digest currently reaches *past* day digests into raw entries (via `opts.entries`) to compute working_shapes + interaction_grammar. That works but it means the day digest never gets these signals — the week digest is the only place they live.

2. **The day digest is analytically thin.** A reader looking at `/digest/2026-04-22` sees headline + narrative prose + numbers. They can't see "today was a spec-review-loop day" or "you opened with brainstorming + 4 reviewer dispatches" — the day's *shape* never gets named at the day level. They have to read the narrative to infer.

3. **The week LLM does the heavy lifting twice.** It receives raw working_shapes + grammar (deterministic) AND the day digests' free-form narratives (LLM-produced). To produce a coherent week story it has to reconcile these two sources. If the day digests had already classified themselves, the week LLM would just be weaving across pre-classified days.

4. **Month digest will inherit the same problem.** When we extend this work to month, MonthDigest will reach past Week into Day or Entry to compute things — same violation.

5. **Re-derivation is expensive and brittle.** Every week regen re-runs pattern detection over hundreds of entries. The day-level data isn't memoized into a stable form.

---

## What you're proposing (read me back to confirm)

Move the pattern-detection layer down so the day digest classifies itself. The week digest then aggregates day-level classifications. Concretely:

```
Entry           numbers + LLM enrichment (today)
                + per-entry signals: working_shape, prompt_frames,
                  subagent roles, communication signals       ← NEW
   │
   ├─ DayDigest aggregates per-Entry signals into:
   │              day_working_shape (dominant shape today)    ← NEW
   │              day_signals { skills, frames, refs, ... }   ← NEW
   │            LLM narrative grounded in those classifications
   │
   └─ WeekDigest reads DayDigest only (no raw entries)
                  aggregates day_working_shape distribution
                  aggregates day_signals (union/sum)
                  LLM produces what_worked/stalled/surprised/lean
                  anchored to per-day classifications
```

The capsule stays the source of truth for raw signal. The day digest becomes the analytical unit. Week and month do pure aggregation.

---

## Per-layer changes

### Entry layer — where the raw signal lives

`packages/entries/src/types.ts` — extend `Entry`:

```ts
export type Entry = {
  ...existing,

  /** NEW — per-Entry classifications computed deterministically at build
   *  time from the same data the LLM enrichment sees. Cheap, no LLM call. */
  signals: {
    working_shape: WorkingShape | null;        // session shape (current logic)
    prompt_frames: PromptFrame[];              // detected on first_user
    subagent_roles: SubagentRole[];            // one per dispatched subagent
    /** Communication-style markers — characterize THIS session's interaction. */
    verbosity: "short" | "medium" | "long" | "very_long";  // first_user length bucket
    external_refs: Array<{ kind: ExternalRefKind; preview: string }>;
    /** Did this session open with a brainstorming/writing-plans skill load? */
    brainstorm_warmup: boolean;
    /** Was this session a continuation (literal "continue") or handoff-prose? */
    continuation_kind: "none" | "literal-continue" | "handoff-prose";
  };
};
```

This is an additive change — old entries without `signals` get null/empty defaults at read time. Build (rebuild on next daemon sweep or manual `fleetlens entries regenerate`) populates them.

**The Entry-build code already has all the data it needs.** The classifiers we wrote (`inferWorkingShape`, `detectPromptFrames`, `classifySubagentRole`) just need to be called at Entry-build time instead of week-aggregation time.

### Day digest layer — where the day classifies itself

`packages/entries/src/types.ts` — extend `DayDigest`:

```ts
export type DayDigest = ...envelope & {
  ...existing,

  /** NEW — aggregations of per-Entry signals across the day. */
  day_signals: {
    /** Dominant shape today, weighted by active_min. "mixed" if no entry
     *  exceeds 60% of the day's active_min. null on trivial days. */
    dominant_shape: WorkingShape | "mixed" | null;
    /** Per-shape session counts so the digest can say "today was 2
     *  spec-review-loop sessions and 1 chunk-implementation". */
    shape_distribution: Partial<Record<WorkingShape, number>>;

    skills_loaded: Array<{ skill: string; origin: SkillOrigin; count: number }>;
    user_authored_skills_used: string[];      // bare names; week aggregates families
    user_authored_subagents_used: Array<{ type: string; count: number; sample_prompt_preview: string }>;

    prompt_frames: Array<{ frame: PromptFrame; origin: "claude-feature" | "personal-habit"; count: number }>;

    /** Communication style for THIS day. */
    comm_style: {
      verbosity_distribution: { short: number; medium: number; long: number; very_long: number };
      external_refs: Array<{ session_id: string; kind: ExternalRefKind; preview: string }>;
      steering: { interrupts: number; frustrated: number; dissatisfied: number; sessions_with_mid_run_redirect: number };
    };

    brainstorm_warmup_session_count: number;
    todo_ops_total: number;
    plan_mode_used: boolean;     // any entry today had exit_plan_calls > 0 or plan_used flag
  };
};
```

**Day digest LLM prompt gets the new signals as input.** The day digest's existing narrative fields (`headline`, `what_went_well`, `what_hit_friction`, `suggestion`) become *anchored to the day's classifications* — same anchor system as the week.

A new optional field: `day_signature` — one short line characterizing the day's shape that the week digest can quote.

```ts
day_signature: string | null;
// e.g. "spec-review-loop on Phase 1b: 3 reviewers + 1 implementer, shipped clean"
//      "solo-build with mid-run redirect: ConnectionRefused at minute 70"
//      "research-then-build: 3 Explore subagents + 1 implementer, ahora v8 spec drafted"
```

**Day digest renderer** gets a new "How today worked" mini-section right under the headline showing:
- Dominant shape badge ("spec-review-loop" / "solo-build with brainstorm warmup" / "mixed")
- Subagent dispatches grouped by role (3 reviewers, 1 implementer, 2 explorers)
- Skills loaded with origin tags
- Comm-style indicators (verbosity, external refs, steering count)
- Plan-mode usage / absence

### Week digest layer — pure aggregation

`packages/entries/src/digest-week.ts` — `buildDeterministicWeekDigest` no longer accepts `entries`. It reads only DayDigests:

```ts
// BEFORE
buildDeterministicWeekDigest(monday, dayDigests, { entries });
// computes working_shapes from entries, interaction_grammar from entries

// AFTER
buildDeterministicWeekDigest(monday, dayDigests);
// aggregates working_shapes from dayDigests[].day_signals.shape_distribution
// aggregates interaction_grammar from dayDigests[].day_signals.{skills,frames,comm_style,...}
```

**Skill families and threads stay at week level** — they're inherently cross-day:
- `skill_families` aggregates `user_authored_skills_used` across days, groups by prefix-before-hyphen
- `threads` is by definition multi-day (same session_id across distinct local_days; the week is where you can see this)

Everything else flows up from per-day classifications.

**Week LLM prompt** gets per-day `day_signature` strings + the aggregated rollups. It writes the cross-day story:

> *Wednesday's spec-review-loop on Phase 1b shipped clean while Friday's chunk-implementation on the self-update sprint produced the same shape's most rigorous run (paired reviewer per chunk). The two-shape contrast is the week's story.*

That's a sentence the week LLM can write WHEN it sees pre-classified days. Currently it has to invent the framing each time.

### Month digest layer — same pattern

MonthDigest reads only WeekDigest (already does). It aggregates `working_shapes` distributions across weeks → "you did 3 spec-review-loop weeks in a row, then a solo-build dominated week." Trivial once weeks carry classified shape distributions.

---

## Before / after — what a day digest actually looks like

### Before (today, `/digest/2026-04-22`)

```
Wed Apr 22 · 647m · 4 PRs shipped

You built Phase 1b LLM enrichment, the GCP Cloud Run installer,
and the cold-cache timeline indicator.

What went well:
  Phase 1b shipped clean after the spec-review pass.

What hit friction:
  loop_suspected fired during the longest autonomous run.

Suggestion:
  Add explicit step limits to harness-orchestrate.
```

The reader has to *infer* it was a spec-review-loop day. The day's analytical shape is buried in the narrative.

### After (proposed)

```
Wed Apr 22 · 647m · 4 PRs shipped

  ┌── How today worked ──────────────────────────────────┐
  │ Spec-review-loop · 3 sessions                        │
  │   3 reviewer dispatches + 1 implementer + 1 explorer │
  │   Skills: superpowers:brainstorming ×2, harness-engine│
  │   Comm style: 2 long prompts, 1 external ORB ref     │
  │   No Plan Mode · 0 mid-run redirects                 │
  └──────────────────────────────────────────────────────┘

You built Phase 1b LLM enrichment, the GCP Cloud Run installer,
and the cold-cache timeline indicator. The spec-review-loop on
Phase 1b ran 3 reviewer subagents before code; shipped clean
without redirect.

What went well · [anchor: spec-review-loop]
  The reviewer pass on Phase 1b caught the schema-versioning gap
  before code; that's why the 130-min build had no friction.

What hit friction · [anchor: solo-build]
  loop_suspected fired during the cold-cache implementation
  (separate session) — 8 consecutive Read calls during exploration.

Suggestion · [anchor: solo-build]
  Add explicit step limits to harness-orchestrate.

Day signature: spec-review-loop on Phase 1b: 3 reviewers + 1 implementer, shipped clean.
```

Now the reader sees the day's shape immediately. The narrative anchors to it. The week digest can quote `day_signature` directly.

---

## What the week digest looks like under this model

The week LLM's input becomes much smaller and cleaner:

```json
{
  "period": {...},
  "day_summaries": [
    {
      "date": "2026-04-22",
      "day_signature": "spec-review-loop on Phase 1b: 3 reviewers + 1 implementer, shipped clean",
      "headline": "...",
      "what_went_well": "...",
      "what_hit_friction": "...",
      "dominant_shape": "spec-review-loop",
      "shape_distribution": { "spec-review-loop": 3, "solo-build": 2 },
      "skills_loaded": [...],
      "comm_style": {...}
    },
    ...
  ],
  "week_aggregates": {
    "shape_distribution": { "spec-review-loop": 6, "chunk-implementation": 3, ... },
    "skill_families": [...],
    "threads": [...],
    "comm_style_rollup": {...}
  }
}
```

The week LLM writes what_worked/stalled/surprised/lean **as cross-day claims grounded in the day_signatures it can quote verbatim**. No more re-deriving shapes from raw entry data; no more parallel narratives that don't reconcile.

---

## Migration story

Schema is additive at both Entry and DayDigest levels. Stays at v2.

- **Entries built before this change:** `signals` is undefined. Read-time helper returns null/empty defaults; week-level aggregation falls back to current per-Entry computation when `signals` is missing. So old entries keep working; new entries enrich.
- **Day digests built before this change:** `day_signals` and `day_signature` undefined. Week aggregation falls back to per-Entry computation for those days (same as today's path).
- **Week digests:** they re-roll on demand. First re-roll under this change picks up the new shape, others stay legacy until re-rolled.

No mass regeneration required. The system upgrades naturally as users navigate or re-roll.

---

## Why this is better

| Today | Proposed |
|---|---|
| Day digest narrative without analytical anchor | Day digest reader sees the day's shape at a glance |
| Week LLM re-derives patterns from raw entries every regen | Week LLM aggregates pre-classified days |
| Strict-hierarchy violation (week reaches past day) | Strict hierarchy honored (week reads only day) |
| Patterns visible only at week level | Patterns visible at day level too |
| Month digest will inherit the violation | Month digest gets pure rollup naturally |
| Two parallel narratives (day prose + week patterns) | One narrative spine, anchored at every layer |

---

## Effort estimate

Roughly the same scope as the redesign in PR #26 (~16h) but distributed across two layers:

| Item | Effort |
|---|---|
| Move classifiers (working_shape / prompt_frames / subagent_roles / verbosity / external_refs) into Entry build | ~2h |
| Add `Entry.signals` to types + builder + schema regeneration trigger | ~1h |
| Add `DayDigest.day_signals` + `day_signature` to types + builder | ~2h |
| Day digest prompt: anchor narrative fields to day shape; produce day_signature | ~2h |
| Day digest renderer: "How today worked" mini-section under headline | ~3h |
| Week digest builder: read day_signals, drop entries dependency | ~2h |
| Week digest prompt: simpler input, day_signatures quotable | ~1h |
| Verify: typecheck + tests + sample regen on a day + a week | ~2h |
| **Total** | **~15h** |

Cleanly cuts into 3 PRs:
1. **Entry signals + day_signals** — additive types + builder, no UI change.
2. **Day digest prompt + renderer** — flips the day surface to use new data.
3. **Week digest refactor** — drops the entries reach-around, simpler aggregation.

Each PR is independently shippable.

---

## What this opens up later

Once shapes + signals are stable at the day level:

- **`fleetlens day shape <date>`** CLI — print the day's classification without invoking an LLM.
- **Project-scoped digests** become trivial — group day_signals by project across the period.
- **Streak detection** — "you've had 4 spec-review-loop days in a row" — reads day_signals[].dominant_shape sequentially.
- **Personal playbook view** — "your most-shipped shape is spec-review-loop; your highest-friction shape is solo-build" — pure day-level rollup over a long window.

These are all hard today (week is the lowest aggregation layer that knows shapes). Trivial under the proposal.

---

## What I want from you before I start

1. **Sign-off on the architecture.** Day digest carries `day_signals` + `day_signature`; week digest does pure aggregation.
2. **Day signature line — keep, or skip?** It's the one new LLM output (the day-level shape sentence). Strong rollup signal for the week, but adds one more LLM-produced field. Alternative: skip it and let the week LLM compose its own sentence per day from the structured signals.
3. **Cached digest behavior.** Old day digests have null `day_signals`. Two options:
   - (a) Day digest renderer falls back to legacy view for old digests; auto-regenerates on next visit.
   - (b) Day digest renderer renders empty mini-section + "Re-roll for today's shape" prompt.
   I'd ship (a) — fewer "click to upgrade" prompts.
4. **Where to ship the selfhosted feature in the sequence?** Three PRs of this refactor + the selfhosted work — what order do you want them in?

If the architecture lands well, I'd start with PR 1 (Entry signals + day_signals deterministic) since it's pure data layer, no UI change, and you can poke at the data before the renderer and prompt rewrites land.
