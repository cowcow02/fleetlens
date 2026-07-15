# Redesigned weekly digest — design + reverse-engineering

**Status:** design doc. Two parts.

- **Part A** — what the W17 report looks like in the new shape (read this top-to-bottom; if it doesn't tell you the picture in one read, the design has failed).
- **Part B** — how to make it. What changes at the data layer, the prompt layer, and the renderer layer to produce Part A from raw entries.

---

# Part A — The W17 report, redesigned

What follows is a sample render of `/insights/week-2026-04-20` in the new shape. Compare against the current rendered version to see the delta.

---

## Week of 2026-04-20 · Apr 20 – Apr 26

**vs last week:** +18 PRs · +3.1h · helpfulness held at *helpful*

> **You shipped 22 PRs through a spec-review-loop on the four design-anchored days; long-autonomous `general-purpose` dispatches did the heavy lifting and you never once gated work with Plan Mode.**

*Subagent orchestration as the default, `superpowers:brainstorming` warmups on every design day, zero formal plan gates.*

---

### How you worked

The week's working shape, in order of dominance:

#### Spec-review loop · used 3 days · shipped 3 of 3
The pattern: write a spec or plan → dispatch `general-purpose` to *"Review plan chunk N — verify this is complete and ready for implementation"* → revise → re-dispatch *"Re-review revised plan"* → implement. Two-to-three review rounds before any code.

| Day | Session | Spec | Review rounds | Outcome |
|---|---|---|---|---|
| Wed 04-22 | e80b3554 | Phase 1b LLM enrichment | 3 chunks × reviews | shipped |
| Wed 04-22 | 9688cea8 | V2 perception layer | 1 spec + 1 re-review | partial |
| Fri 04-24 | 4884407b | Team-server self-update | 1 spec + 1 re-review + 1 staff-model | shipped |

> *"You are a plan document reviewer. Verify this plan chunk is complete and ready for implementation. Plan file: …Phase-1b enrichment plan."* — Wed e80b3554, one of 3 review subagents

#### Chunk implementation with paired reviewers · used 1 day · shipped
Friday's self-update sprint dispatched implementation in chunks, each followed by both a spec-compliance review *and* a code-quality review. Reviewer-type was matched to purpose: stock `superpowers:code-reviewer` for code quality, `general-purpose` for spec compliance.

> *"Implement Chunk 1 (Tasks 1.1–1.5) of Plan 1b: RBAC foundation for team-server self-update."* → *"Spec-review Chunk 1"* → *"superpowers:code-reviewer: Code-quality review Chunk 1"*

#### Research-then-build · used 2 days · 1 shipped, 1 partial
Mon dispatched 2 Explore subagents at the vinuage FE + BE branches *plus* a `claude-code-guide` subagent researching the Claude Agent SDK before any code. Wed dispatched an Explore subagent to reverse-engineer Anthropic's own `/insights` source code in `/Users/cowcow02/Repo/claude-code-source/src/` before designing V2's day-scoped layer.

> *"Explore the frontend branch `feature/ai-wine-assistant` in the React app. Do NOT switch branches; report the architecture and entry points."* — Mon f0808012

#### Reviewer triad · used 1 day · shipped
Wed's cold-cache indicator (0368a77e) dispatched three parallel `general-purpose` reviewers — *Code reuse review*, *Code quality review*, *Efficiency review* — same diff, three lenses. More rigorous than typical PR review.

#### Solo continuation (no subagents) · used 1 day · partial
Tuesday's 1d3c1cd4 was a 71-min "continue" of the prior day's retro pipeline, no subagent dispatches, ended on `ConnectionRefused`.

---

### Your interaction grammar

Patterns that aren't tracked in the count layer but show up in *how* you talk to the harness:

- **Brainstorming as warmup ritual.** `superpowers:brainstorming` opened every design day this week — Mon vinuage, Wed V2 perception, Sat ahora. Skill-load → planning mode.
- **Cross-session handoff via prose preamble.** `4884407b` spans Wed → Thu → Fri; each new session opens with `## Session conclusion — Phase 1A` or `# Handoff: Fleetlens Team Edition` prose copied from the prior session's output. Manual continuity protocol.
- **TodoWrite as orchestration substrate.** 469 task operations this week — not a personal checklist; a way for the parent session to direct itself while subagents fan out.
- **`<teammate-message>` harness frame.** Tue 198910c9 (ORB-183 sidebar) opened with `<teammate-message teammate_id="team-lead">` — your structured handoff format from a coordinator role into a teammate worktree. Not stock Claude Code; an abstraction you built.
- **Image-attached prompts.** 5 sessions opened with `[Image #N]` references — visual cue → quantitative ask.
- **No Plan Mode.** Zero `ExitPlan` calls in 47 entries this week. You DO plan — via spec docs and review subagents — but the canonical `/plan` tool didn't fit your shape.

---

### What worked

**Spec-review loop shipped 3 of 3 designs cleanly.** The reactive-review-then-implement pattern caught issues at spec time. Phase 1b, V2 perception, and self-update all reached a clean implement phase because the reviewer subagents had already surfaced gaps.

**Reviewer-type-to-purpose matching is mature.** Wed's cold-cache used 3 different review lenses (reuse / quality / efficiency); Fri self-update mixed `superpowers:code-reviewer` (stock) for code quality with `general-purpose` for spec compliance. You're picking the right reviewer for each concern — most teams use one reviewer for everything.

**Research-then-build eliminated architectural drift on Mon's 216-min push.** The 2 Explore subagents up front meant the vinuage build didn't have to course-correct on architectural choices mid-stream — the agent had a clear map before writing code.

**`brainstorming` skill consistently preceded design quality.** All 3 design days that used it produced sound specs. The skill isn't decorative; it's predictive of design-day output.

---

### What stalled — and what shape it stalled inside

**API connectivity cut Mon + Tue.** `ConnectionRefused` / `FailedToOpenSocket` killed the longest `general-purpose` dispatches on back-to-back days. Both stalls happened *at the end* of unbroken long-autonomous runs — the same shape that shipped clean on Wed/Fri. The transport failure is mode-shape-specific: long-autonomous runs have no checkpoint to recover to.

**Mid-run drift on Wed/Fri/Sat happened inside long `general-purpose` dispatches without plan gates.** The redirection cost wasn't a generic "long session" issue; it was specifically that nothing forced the agent to surface its intended sequence before execution started. The shape that shipped 13 of 22 PRs is also the shape that needed every mid-run intervention.

**Friday's 9-PR self-update cascade pushed chunk-implementation past its limits.** Reviewer subagents caught spec issues, but couldn't catch deploy-time issues (.js suffix, GHCR token, GCP image repo) — those needed an actual deployment to surface. Reviewer triad doesn't substitute for a verify-after-deploy step.

---

### What surprised

**Competitive analysis via subagent.** Wed 9688cea8 dispatched an Explore subagent to read Anthropic's own `/insights` source for V2 design reference. Most users wouldn't think to delegate this; you treated it as a normal subagent task.

**The `<teammate-message>` harness ran a background env-setup agent in parallel with the implementing teammate.** Tue 198910c9 dispatched `general-purpose` "Env setup for ORB-183" with `background: true` — coordinator-style orchestration where two subagents work the same goal at different layers (env vs code).

**The week's range was wider than most.** Mon's 216-min vinuage push (single-shot `partial`) and the prior week's Tue 8-min daemon-fix (single-shot `shipped`) bracket the spectrum. Same approach (long autonomous), opposite outcomes. The difference: Tue had a scoped task; Mon was an open-ended end-of-feature push.

---

### Where to lean

1. **Codify reviewer-type selection in CLAUDE.md.** You're already picking right reviewers by feel. Write the rule down — *"code-quality → `superpowers:code-reviewer`; spec-compliance → `general-purpose`; design-coherence → `claude-code-guide`"* — so subagent dispatchers and future-you don't re-derive it.

2. **Pre-commitment review, not post-hoc.** The spec-review loop reviews specs you've already written. Add a *"challenge the spec's assumptions before I commit to writing it"* subagent dispatch. The convention drift on Mon ("agent air time" → "non-idle time" correction at minute 90) would land at minute 5.

3. **`harness-handoff` skill.** 4884407b spans 3 days via manual prose handoff copied from prior sessions. A skill that *generates* the handoff prompt from the prior session's TodoWrite + `final_agent` text would automate it.

4. **Connection-error recovery hook.** 2-of-2 mid-week stalls were socket-layer. A `PostToolUse` hook on `Bash` that detects `ConnectionRefused`/`FailedToOpenSocket` patterns and snapshots the last N tool calls + open files would let the next session resume without re-deriving state.

5. **Plan Mode is a deliberate gap.** 0 `ExitPlan` in 47 entries — but you DO plan. Decide explicitly: are spec-review subagents your *post-Plan-Mode* workflow, or is Plan Mode a tool you've never tried at this scale? Either answer is fine; the current ambiguity isn't.

---

### By the numbers (skim)

| Metric | This week | Δ vs W16 |
|---|---|---|
| Agent time | 28.4h across 6 days | +5h |
| PRs shipped | 22 | +18 |
| Subagent dispatches | 146 (general-purpose ×115, code-reviewer ×23, Explore ×5) | +significant |
| TodoWrite ops | 469 | + |
| Skill loads | 97 (brainstorming ×10, writing-plans ×6) | + |
| Plan-gating | 0 ExitPlan, 0/7 days | unchanged |
| Tools per turn | 10.7 (mixed) | + |
| Long-autonomous days | 4 of 6 | + |

---

# Part B — How to make this version

The current pipeline produces *counts and floating prose*. The redesigned report needs *named shapes anchored to evidence*. Three layers change:

## 1. Data layer

### 1a. Subagent role classification (per Entry, deterministic)

Add `role` to each `EntrySubagent`:

```ts
type SubagentRole = "reviewer" | "implementer" | "explorer" | "researcher"
                  | "env-setup" | "polish" | "other";

type EntrySubagent = {
  type: string;          // existing
  description: string;   // existing
  background: boolean;
  prompt_preview: string;
  role: SubagentRole;    // NEW
};
```

Classification rule (regex on `description` + `prompt_preview`):

| Match | Role |
|---|---|
| `/review/i`, `/verify/i`, `/audit/i`, `/code-quality/i`, `/spec-compliance/i` | `reviewer` |
| `/implement/i`, `/build/i`, `/Implement (Task|Chunk) \d+/i` | `implementer` |
| `/explore/i`, `/inventory/i`, `/map.*codebase/i`, `/branch architecture/i` | `explorer` |
| `/investigate/i.*\bGitHub\b/, `/research/i`, `/reverse-engineer/i` | `researcher` |
| `/env(?:ironment)? setup/i`, `/initialize/i`, `/configure/i` | `env-setup` |
| `/polish/i`, `/UI polish/i`, `/cleanup/i` | `polish` |
| (no match) | `other` |

This is cheap — string matching at entry-build time, no LLM. Stored on disk with the Entry.

### 1b. Working-shape detection (per session, deterministic)

Add `working_shape` to each Entry. Inferred from the *sequence* of subagent dispatches within the session:

```ts
type WorkingShape =
  | "spec-review-loop"         // ≥2 reviewer dispatches against same target
  | "chunk-implementation"     // ≥2 implementer dispatches with "Chunk N"/"Task N"
  | "research-then-build"      // explorer/researcher in first 25% then implementer
  | "reviewer-triad"           // ≥3 reviewer dispatches with distinct lens descriptions
  | "background-coordinated"   // ≥1 background:true subagent + foreground work
  | "solo-continuation"        // 0 subagents, first_user starts with "continue"
  | "solo-design"              // 0 subagents, brainstorming skill loaded
  | "solo-build"               // 0 subagents, no continuation/design markers
  | null;                      // ambiguous
```

Decision rules:
1. If `subagent_calls === 0`: pick from solo-* variants based on first_user/skills.
2. If `≥2 reviewer dispatches` against the same chunk/spec ref: `spec-review-loop`.
3. If `≥2 implementer dispatches` with "Chunk N" or "Task N" descriptions: `chunk-implementation`.
4. If first 25% of dispatches are explorer/researcher and rest are implementer: `research-then-build`.
5. If `≥3 reviewer dispatches` in same session with distinct review-lens descriptions (regex differs): `reviewer-triad`.
6. If any `background: true` subagent: prefer `background-coordinated` if 1 of the above also matches; else as primary.

Cheap to compute. Stored on the Entry.

### 1c. Prompt-frame detection (signals layer)

Extend `signals.ts`:

```ts
type PromptFrame = "teammate" | "local-command-caveat" | "handoff-prose"
                 | "image-attached" | "session-conclusion";

function detectPromptFrames(text: string): PromptFrame[] {
  const out: PromptFrame[] = [];
  if (/<teammate-message\b/.test(text)) out.push("teammate");
  if (/<local-command-caveat\b/.test(text)) out.push("local-command-caveat");
  if (/^# Handoff:/.test(text) || /^## Session conclusion/m.test(text))
    out.push("handoff-prose");
  if (/\[Image #\d+\]/.test(text)) out.push("image-attached");
  return out;
}
```

Aggregate at week level: `prompt_frames: Array<{ frame, count, days }>`.

### 1d. User-authored skill flag (deterministic)

In Entry build, classify each skill key:

```ts
function isStockSkill(name: string): boolean {
  return /^(superpowers|mcp__|frontend-design|code-review|codex|claude-code-guide|using-superpowers):/.test(name);
}
```

Store `skills_by_origin: { stock: Record<string, number>; user: Record<string, number> }` per Entry.

User-authored skills (`harness-orchestrate-*`, `cloud-verify`, `simplify`, etc.) are first-class in the digest as evidence of the user's own tooling.

### 1e. Cross-session thread detection (week aggregation)

A "thread" is a chain of entries where:
- Same `session_id` across multiple `local_day`s, OR
- A new entry's `first_user` contains a `handoff-prose` frame referencing the prior entry's project/work

Aggregate at week level:

```ts
threads: Array<{
  thread_id: string;        // first session_id in chain
  entries: Array<{ date, session_id, project }>;
  total_active_min: number;
  outcome: DayOutcome | null;  // outcome of the final entry
}>;
```

### 1f. Working-shape rollup (week)

Replace the 4 numeric mode cards with a typed shape rollup:

```ts
working_shapes: Array<{
  shape: WorkingShape;
  occurrences: Array<{
    date: string;
    session_id: string;
    project: string;
    outcome: DayOutcome | null;
    evidence_subagent: { type: string; description: string; prompt_preview: string } | null;
    evidence_first_user: string | null;
  }>;
  outcome_distribution: Record<DayOutcome, number>;
}>;

interaction_grammar: {
  brainstorming_warmup_days: string[];
  prompt_frames: Array<{ frame: PromptFrame; count: number; days: string[] }>;
  user_authored_skills: Array<{ skill: string; count: number; days: string[] }>;
  threads: Array<{ ...thread shape }>;
  todo_ops_total: number;
  plan_mode: { exit_plan_calls: number; days_with_plan: number };
};
```

Renderer + prompt both consume this in place of `interaction_modes`.

## 2. Prompt layer

The current week prompt asks for `recurring_themes`, `friction_categories`, `outcome_correlations`, `suggestions`. Replace with **5 narrative fields anchored to working shapes**:

```ts
WeekDigestNarrative = {
  headline: string;        // ≤120 chars, second-person, names a working shape
  key_pattern: string;     // ≤80 chars, names dominant shape + texture (skill ritual, plan-mode absence)

  what_worked: Array<{
    title: string;                       // ≤80 chars
    detail: string;                      // 2-3 sentences
    anchor_shape: WorkingShape;          // EVERY finding cites a shape
    evidence: { date: string; quote: string };  // verbatim from data
  }>;  // 3-5 items

  what_stalled: Array<{
    title: string;
    detail: string;
    anchor_shape: WorkingShape;          // EVERY stall cites the shape it stalled inside
    evidence: { date: string; quote: string };  // substring-grounded
  }>;  // 2-4 items

  what_surprised: Array<{
    title: string;
    detail: string;
    anchor: "outlier" | "novel-use" | "user-built-tool" | "cross-week-contrast";
    evidence: { date: string; quote: string };
  }>;  // 1-3 items

  where_to_lean: Array<{
    headline: string;
    detail: string;                      // 2-4 sentences, includes copyable prompt or rule
    anchor_shape: WorkingShape | "interaction_grammar" | "plan-mode-gap";
    type: "claude-md" | "skill" | "hook" | "harness" | "decision";
  }>;  // 3-6 items
};
```

The prompt rules become:

> Every `what_worked`/`what_stalled`/`what_surprised`/`where_to_lean` entry MUST set `anchor_shape` (or `anchor`) to a value present in `working_shapes` or `interaction_grammar`. Findings that don't tie to a shape are dropped — that's the test for "earned its space".

This kills the floating prose problem. The LLM has fewer fields, each tightly typed, each requiring evidence + shape anchor. The output IS the report.

## 3. Renderer layer

### 3a. Replace `<InteractionModesSection>` with `<WorkingShapesSection>`

For each working shape:
- Header: shape name + usage count + outcome distribution (e.g. *"Spec-review loop · used 3 days · shipped 3 of 3"*)
- Body: 1-2 sentences describing the pattern
- Evidence: most-illustrative subagent prompt or first_user (already in data)
- Optional table: per-occurrence row with date / session / outcome

### 3b. Add `<InteractionGrammar>` subsection

Bullet list:
- Brainstorming warmup days
- Prompt frames detected (with count + days)
- User-authored skills used
- Cross-session threads (with chain length)
- TodoWrite total
- Plan Mode usage / absence prose

### 3c. Replace 3 sections (Patterns / Friction / Suggestions) with 4 sections matching the new schema

- `<WhatWorked>` — green cards, each citing a shape via tag chip
- `<WhatStalled>` — orange cards, each citing the shape it stalled inside
- `<WhatSurprised>` — purple cards, anchor type as tag (outlier / novel / user-built / contrast)
- `<WhereToLean>` — three groups by `type`: CLAUDE.md additions, skills/hooks to build, decisions to make

The "By the numbers" section becomes a fold-down at the bottom, not a top concern.

## 4. Migration plan

This is a *schema bump* on WeekDigest. Past digests (cached) won't have the new fields. Two options:

**Option A: Schema version bump** — `CURRENT_WEEK_DIGEST_SCHEMA_VERSION = 3`. On read, if `version < 3`, treat as not-cached and re-generate. Cost: re-runs the LLM on all cached weeks (≤5 weeks for most users, ~$0.05 total).

**Option B: Additive + render-old-shape-cleanly** — old digests render as today; new digests get the new shape. Renderer branches on presence of `working_shapes`. No regen needed, but the dashboard is heterogeneous until users regenerate manually.

I'd ship **Option A**. The new shape is materially different and "consistency across cached digests" is more valuable than "save $0.05".

## 5. What this opens up

Once `working_shapes` is on disk per-week, several month-level features become trivial:

- **Shape evolution.** Did spec-review-loop replace solo-build over the last 4 weeks?
- **Shape-outcome correlation across weeks.** Does chunk-implementation ship faster than spec-review-loop on average?
- **Personal playbook.** "Your dominant shape is spec-review-loop. Your second is research-then-build. Your reviewer-triad is rare but always ships."

These were *impossible* with `top_flags` aggregation; trivial with `working_shapes` rollup.

---

## Engineering effort estimate

| Item | Effort | Risk |
|---|---|---|
| Subagent role classification (1a) | ~1h | low — pure regex |
| Working-shape detection (1b) | ~3h | medium — needs care on rule precedence |
| Prompt-frame detection (1c) | ~1h | low |
| User-authored skill flag (1d) | ~30m | trivial |
| Thread detection (1e) | ~2h | medium — handoff-prose matching is fuzzy |
| Working-shapes week aggregator (1f) | ~2h | low |
| Prompt rewrite (2) | ~2h iterating | medium — prompt-craft cycles |
| Renderer rewrite (3) | ~4h | low |
| Schema version bump + migration (4) | ~1h | low |
| **Total** | **~16h** | |

Cuts cleanly into 2-3 PRs:
1. Data layer additions (1a–1f) — non-breaking, lands without rendering anything new.
2. Prompt + renderer (2–3) — flip the surface to use the new data.
3. Schema bump + migration (4) — release-time concern, smallest piece.
