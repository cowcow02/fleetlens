# Data mining vs current report — what's there, what's missed

**Window:** 2026-04-14 → 2026-04-27 · 85 entries across 18 multi-day session threads.
**Source:** `~/.cclens/entries/*.json` — deterministic per-Entry data (subagents/skills/numbers/flags + LLM-enriched first_user/brief_summary/friction_detail).
**Purpose:** identify what the *current* report (commit `868e871`, working_shapes + interaction_grammar + 4 narrative buckets) **would** surface vs what's actually visible if you read the data by hand. The gap tells us what to fix next.

---

## Findings the data shows

### 1. The user is a **harness builder**, not just a Claude Code user

Custom skills used in this window — every one is project-local, authored by the user:

| Skill | Loads | Days |
|---|---|---|
| `harness-engine` | 4 | claude-lens (Apr 17, 21, 22) |
| `harness-build` | 2 | various |
| `harness-build-pickup` | 2 | claude-lens (KIP work) |
| `harness-build-environment` | 2 | claude-lens |
| `harness-build-understand` | 2 | claude-lens |
| `harness-orchestrate-analyze` | 2 | agentic-knowledge-system |
| `harness-orchestrate-retrospective` | 1 | claude-lens |
| `simplify` | 2 | (the user's `/simplify` slash command) |
| `retrospective` | 1 | claude-lens |

Plus custom subagent type **`implement-teammate`** dispatched 2× on 2026-04-21 (`Implement ORB-182 Cmd+K fixes` / `Implement ORB-183 sidebar settings IA`). That's the user's own Task subagent type.

Plus a custom slash command **`/harness-orchestrate`** invoked twice via `<command-name>` framing (Apr 21, two sessions).

Plus the **`<teammate-message teammate_id="team-lead">`** framing — 6 sessions in the window. This is the user's coordinator-to-teammate handoff format.

Plus the **`<task-notification>`** framing — 2 sessions opened by an auto-monitor process (`fleetlens web :3333 watchdog`). That's a separate auto-trigger system.

**Read together: the user has built an entire harness around Claude Code — custom skills (10+), custom subagents (`implement-teammate`), custom slash commands (`/harness-orchestrate`), custom prompt frames (`<teammate-message>`, `<task-notification>`), custom auto-monitors.** This is the most distinctive thing about how they work, and it's the thing the report most underplays.

### 2. Prompt opener taxonomy is broader than I assumed

Of 85 sessions, openers break down into:

| Opener type | Count | Notes |
|---|---|---|
| Long-form / strategic context | ~25 | Multi-paragraph cofounder positioning, product roadmap thinking, scoping a new product |
| `<local-command-caveat>` | 14 | Used as anti-prompt-injection wrapper |
| Greeting + status check ("Hey, where are we at?", "Good morning") | 9 | "Re-orient me to the project" mode |
| `<teammate-message>` harness | 6 | Coordinator dispatching to a teammate role |
| Handoff prose (broad: "here's the handoff prompt", "wrap-up summary", "all wrapped up", "session-close summary") | 5 | Cross-session continuity protocol |
| `continue` (literal) | 4 | Pure continuation |
| `<task-notification>` (auto-monitor) | 2 | The user's own monitor triggers |
| Slash command (`<command-name>` frame) | 2 | `/harness-orchestrate` |
| Image-attached `[Image #N]` | 1 | Visual cue → quantitative ask |
| Status check ("what's next here?") | 1 | |
| Question/exploration ("is the daemon still working?") | several | Diagnostic openers — currently lumped into "other" |
| Imperative directive ("ship X", "fix Y") | several | |

The current `detectPromptFrames()` only catches 23 events across 4 frame types (teammate, local-command-caveat, narrow handoff-prose `^# Handoff:` / `^## Session conclusion`, image-attached). It misses **slash-command** (2), **task-notification** (2), and **broad handoff-prose** (5 additional handoffs that don't start with `#` at line 0).

### 3. The signature orchestration shape is **spec → reviewer triad → chunk-implementation with paired reviewers**

Looking at the 186 `general-purpose` + 30 `superpowers:code-reviewer` dispatches:

- **2026-04-22 0368a77e** (cold-cache shipping) — three parallel general-purpose dispatches with distinct lenses: "Code reuse review", "Code quality review", "Efficiency review". The classic reviewer-triad. ✓ Should fire.
- **2026-04-22 4884407b** (Team Edition self-update spec) — `superpowers:code-reviewer` for "Code-quality review Chunk 1", "Code-quality review Chunk 2", "Code-quality review Chunk 3" + general-purpose for "Spec-review Chunk N" interleaved with "Implement Chunk N" implementers. **This is `chunk-implementation` with PAIRED reviewers** — not just chunk-implementation. The current shape detection picks `chunk-implementation` but loses the per-chunk reviewer-pairing texture.
- **2026-04-22 e80b3554** (Phase 1b enrichment) — three "Review plan chunk N" dispatches before code, then implement. Classic spec-review-loop. ✓ Should fire.
- **2026-04-15 b4b14c03** (Team Orchestration View) — spec-review-loop with "Review team spec doc" → "Review full plan document" → "Re-review revised plan". ✓ Should fire.
- **2026-04-16 4ee3345c** (Team Edition spec → implementation) — "Implement Task 1: Initialize team-server package", "Implement Task 2: Database schema", "Implement Task 3: Crypto utilities" — pure chunk-implementation across 21 dispatches. ✓ Should fire.

The shape detection rules will fire on these, but they all collapse to the same 2 named shapes. The **per-chunk reviewer-pairing texture** is the real signature.

### 4. Multi-day threads are central — and longer than I'd expect

| Session | Project | Days | Span |
|---|---|---|---|
| 5473274c | agentic-knowledge-system | 6 | Apr 16–21 |
| 7389bb45 | claude-lens | 5 | Apr 15–22 (with gap) |
| 1d3c1cd4 | claude-lens | 4 | Apr 17, 20–22 |
| 231de74c | claude-lens | 4 | Apr 17–22 (gappy) |
| 4884407b | claude-lens | 4 | Apr 22–25 |
| a4211da2 | claude-lens | 3 | Apr 22, 24–25 |
| b4b14c03 | claude-lens | 3 | Apr 15–17 (Team Orchestration) |
| f0808012 | vinuage-server | 3 | Apr 20–22 |

**18 multi-day threads** in 14 days. The 6-day `5473274c` thread on `agentic-knowledge-system` is genuinely the spine of one project's work. The current report shows top 3 threads; the rest are invisible.

### 5. Skill families are coherent toolchains, not individual skills

`harness-build` + `harness-build-pickup` + `harness-build-environment` + `harness-build-understand` is clearly one harness toolchain split into stages. `harness-orchestrate-analyze` + `harness-orchestrate-retrospective` is another. The current report lists them individually under "user-authored skills"; the family-level pattern is invisible.

---

## What the current report (commit `868e871`) would surface

Running `inferWorkingShape()` + `computeInteractionGrammar()` against the 14-day window mentally:

**working_shapes** (8 sessions per shape estimated):
- `spec-review-loop` × ~6 (Phase 1b enrichment, Team Orchestration, V2 perception, self-update spec, etc.)
- `chunk-implementation` × ~3 (Team Edition Tasks 1–3, self-update Chunks 1–3)
- `reviewer-triad` × ~1 (cold-cache 0368a77e)
- `research-then-build` × ~3 (Mon vinuage, ccusage research, Anthropic /insights reverse-engineer)
- `solo-continuation` × ~4 ("continue" openers)
- `solo-design` × ~6 (brainstorming-skill openers)
- `solo-build` × dozens (default fallback)
- `background-coordinated` × ~1 (KIP env-setup background subagent)

**interaction_grammar:**
- brainstorming_warmup_days: ~7
- prompt_frames: teammate (6), local-command-caveat (14), handoff-prose (1 — only catching the narrow regex), image-attached (1)
- user_authored_skills: `harness-engine`, `simplify`, `harness-build`, `harness-build-*`, `harness-orchestrate-*`, `retrospective` — listed individually
- threads: 18 detected, top 3 shown
- todo_ops_total: ~750
- plan_mode: 0 ExitPlan, 0 days

**The narrative LLM would then weave** what_worked / what_stalled / what_surprised / where_to_lean from these.

---

## The gap

| What the data shows | What the report surfaces |
|---|---|
| **The user has built an entire harness around Claude Code** — 10+ custom skills, custom subagent type (`implement-teammate`), custom slash command (`/harness-orchestrate`), custom prompt frames (`<teammate-message>`, `<task-notification>`), custom auto-monitor | The harness skills are listed individually under "user-authored skills" with no family grouping; the custom subagent type is lumped into raw `general-purpose` count via type field; the auto-monitor framing is **invisible**; the slash-command framing is **invisible** |
| **`spec → reviewer-triad → chunk-implementation with paired reviewers`** is the signature pipeline. Per chunk, a `general-purpose` "Spec-review Chunk N" runs alongside a `superpowers:code-reviewer` "Code-quality review Chunk N" before the next implementer | The shape detection labels this as `chunk-implementation` only. The per-chunk reviewer-pairing texture is lost. The detection can't say "you pair every chunk with TWO reviewers of different lenses" |
| **18 multi-day threads** in 14 days — including a 6-day thread on `agentic-knowledge-system` | Top 3 surfaced; the long tail invisible |
| **Custom auto-monitor** (`<task-notification>` openers from `fleetlens web :3333 watchdog`) — the user's own watchdog triggers Claude sessions | Currently invisible — not in detectPromptFrames |
| **Custom slash command** `/harness-orchestrate` invoked via `<command-message>` framing | Currently invisible — not in detectPromptFrames |
| **Broad handoff-prose** patterns: "Here's the handoff prompt", "session-close summary", "wrap-up summary", "all wrapped up" | The narrow `^# Handoff:` regex misses 5 of 6 handoff sessions in the window |
| **Strategy/scoping mode** — multi-paragraph cofounder-positioning prompts opening sessions | Currently classified as `solo-build` — no shape captures "long-form strategy session" |
| **Skill families** — `harness-build-*` (4 stages), `harness-orchestrate-*` (3 variants) | Listed individually; family pattern invisible |
| **Custom subagent types** — `implement-teammate` is user-built; `claude-code-guide` is mixed (stock-named but used custom) | Currently aggregated by type into top_types; no flag for "this is a user-built subagent" |
| **Diagnostic question openers** — "is the daemon still working?", "is auto mode enabled here?" | Lumped into solo-build with no shape |

---

## What would close the gap (concrete changes)

In rough effort order, smallest first:

### 1. Broaden `detectPromptFrames` — ~30m

Add three patterns:

```ts
// Slash-command framing (custom commands)
if (/<command-(message|name)\b/.test(text)) out.push("slash-command");
// Auto-monitor framing
if (/<task-notification\b/.test(text)) out.push("task-notification");
// Broaden handoff-prose
if (
  /\b(here'?s the (handoff|handover) prompt|session-close summary|wrap-up summary|all wrapped up|all captured\.)\b/i.test(text)
  || /^##? (Wrap-up|Session conclusion|Handoff)\b/m.test(text)
  || /^# Handoff:/m.test(text)
) out.push("handoff-prose");
```

This lifts current 23 detections → ~32 across the same window. Catches the 6 missing handoffs + the slash command + the auto-monitor.

### 2. Add a `harness` skill family rollup — ~30m

In `computeInteractionGrammar`, group user-authored skills by prefix-before-`-`:

```ts
const userSkillFamilies = new Map<string, { skills: string[]; total_count: number; days: Set<string> }>();
for (const e of entries) {
  for (const skill of Object.keys(e.skills ?? {})) {
    if (classifySkill(skill) !== "user") continue;
    const family = skill.includes("-") ? skill.split("-")[0] : skill;
    // group "harness-build", "harness-build-pickup", etc. all under "harness"
    ...
  }
}
```

Surface as a new field `interaction_grammar.skill_families`. Renderer shows "harness · 11 loads across 5 skills (build, build-pickup, build-environment, build-understand, orchestrate-analyze, orchestrate-retrospective, engine)".

### 3. Detect custom subagent types — ~20m

Stock subagent types are: `general-purpose`, `Explore`, `Plan`, `claude-code-guide`, `playwright-qa-verifier`, `statusline-setup`, `code-simplifier:code-simplifier`, `frontend-design:frontend-design`, `code-review:code-review`, `superpowers:code-reviewer`, `codex:*`, etc. (per the system-prompt's available agents list).

Anything else (e.g. `implement-teammate`) is user-authored.

```ts
function isStockSubagent(type: string): boolean {
  return /^(general-purpose|Explore|Plan|claude-code-guide|playwright-qa-verifier|statusline-setup|frontend-design:|code-review:|code-simplifier:|codex:|superpowers:)/.test(type);
}
```

Surface as `interaction_grammar.user_authored_subagents: Array<{type, count, days, sample_prompt_preview}>`.

### 4. Surface ALL multi-day threads, not just top 3 — ~10m

Currently the renderer slices to 3. Render all 18, with the longest first. UI fold-down for the tail past ~5.

### 5. Add a `strategy-session` working shape — ~30m

Detection: 0 subagents AND `first_user.length > 600` AND no implementer-style verbs in first_user. The cofounder-positioning, product-roadmap, scoping-a-new-app prompts are visible to the eye but invisible to the shape detector.

```ts
if (subagents.length === 0 && (e.first_user?.length ?? 0) > 600
    && !/\b(implement|build|fix|ship|merge|push)\b/i.test(e.first_user?.slice(0, 200) ?? "")) {
  return "strategy-session";
}
```

Add `"strategy-session"` to `WorkingShape` union.

### 6. Add `paired-review-per-chunk` as a sub-classification or richer texture — ~1h

The `chunk-implementation` shape's `evidence_subagent` field could carry an additional flag: `pair_review: { spec: count, code_quality: count }`. Renderer mentions the pairing in the shape's description: "with paired reviewers per chunk: 3× spec compliance + 3× code quality".

Not strictly a new shape, but new texture on the existing one.

### 7. Refine `classifySubagentRole` — ~15m

Add patterns:

```ts
if (/\b(look up|find out|tell me|brief me on)\b/.test(text)) return "researcher";
if (/\b(quick test|sanity check|verify it works)\b/.test(text)) return "reviewer";
```

Catches "Look up skipAutoPermissionPrompt setting" type dispatches that currently fall to "other".

---

## Recommended next PR

**Cheapest wins first** — items 1-4 + 7 = ~2h work, would close most of the visible gap. Items 5 + 6 are nice-to-haves; the strategy-session shape would name an existing pattern that today is anonymous, and the paired-review-per-chunk texture would honor what makes the user's chunk-implementation actually rigorous (not just N parallel implementers).

The most impactful single addition is **#3 — surfacing user-authored subagents** (specifically `implement-teammate`), because that subagent is the *visible link* between the user's harness skills (`harness-build-*`) and the harness coordinator framing (`<teammate-message>`). Right now those three threads of "user has built an orchestration system" appear as: (a) "user-authored skills" bullet, (b) `<teammate-message>` prompt frame, (c) general-purpose subagent count — three separate places that don't cohere.

If we surface `implement-teammate` alongside the other harness elements, the report can finally tell the actual story: **"You have built your own multi-agent orchestration harness on top of Claude Code. This week it ran 6 coordinator-to-teammate dispatches across 2 KIP issues, anchored by the harness-build-* skill family and your `/harness-orchestrate` slash command."** That's the thing the data shows and the report doesn't say.
