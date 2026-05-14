# Team Insight Report — Design Spec

**Date:** 2026-05-14
**Status:** Approved for Phase-1 (static prototype) implementation. Phase-2 (synthesis + data flow + opt-in UX) deferred to a follow-up spec.
**Audience:** Engineers building the team edition of Fleetlens.

---

## 1. Problem statement

Managers of multi-agent coding teams have no good way to see how their team is using AI agents without each member manually writing a progress report. The personal edition already produces a rich weekly insight report at `/insights` per individual. The team edition currently only surfaces deterministic counts (agent time, sessions, tools, turns, tokens via `daily_rollups`) — there is no narrative, no per-member case-study material, no cross-member pattern surfacing.

The goal is a weekly **team insight report** that gives a manager (and the team itself) a compelling story about the week — what shaped the team's work, how members used the agent fleet, what's worth a follow-up — without forcing individuals into manual curation and without leaking conversation content they haven't agreed to share.

The two pulls in tension:
- **Privacy.** Members must trust that their raw prompts and the agent's verbatim responses are not flowing upward by default. The mental test is "would this feel like a keylogger if I were on the receiving end?"
- **Insight.** Aggregate counts alone won't tell the story management cares about (adoption patterns, harness diffusion, strengths to showcase, case studies for individual members).

This spec resolves the tension with a two-tier privacy model and a static-first prototype that demonstrates the end-state output before binding to how it gets produced.

## 2. Nomenclature (locked, used everywhere)

- **Team insight report** — the new weekly artifact at `/team/[slug]/insights`. Mirrors the personal **week digest** at `/insights`.
- **Spotlight** — a single opt-in card on the team insight report. Each spotlight has a *type* (cross-team pattern, individual case study, strength surfacing, narrative summary, shipped work, top session deep-dive, …) and an *author* (a member, or "the team" for synthesized cross-member cards).
- **Tier 1** — data that flows automatically: numbers, durations, taxonomy labels, and the *names* of projects + user-authored skills/subagents. No paraphrase or quote of user/agent text.
- **Tier 2** — data that requires explicit per-section consent: any "words" — LLM-generated prose, quoted user prompts, agent responses, PR titles, prompt previews, sample subagent descriptions, friction quotes.

## 3. Privacy model (final)

### 3.1 The keylogger test

If a field is a paraphrase or quote of what the user typed or what the agent wrote, it's Tier 2. Otherwise Tier 1. This single test is the arbiter for any future field; no other criterion overrides it.

### 3.2 Tier 1 — automatic flow

These fields flow without action from the member, gated only by the team-membership bearer token that already exists. Names of projects and user-authored skills/subagents are Tier 1 because they describe the *shape* of the harness an individual built, not the content of any conversation.

### 3.3 Tier 2 — explicit opt-in

Opt-in is **per-section** and **per-week**, configured on a new personal-edition page (Phase 2). A "remember my choices" sticky default carries selections forward. Each section has an inline **preview pane** so the member sees the exact rendered content before consenting — preview-before-consent is non-negotiable.

### 3.4 Private projects escape hatch

The personal edition keeps a per-member list of project paths marked private. Entries from private projects never flow upward at any tier — no numbers, no labels, no nothing. This is the single per-member kill-switch beyond per-section opt-in.

### 3.5 Team-side LLM (open question — Phase 2)

This spec **does not commit** to whether the team server runs an LLM over received content. Options under consideration:
- Members submit pre-rendered week-digest sections; team server renders verbatim, no LLM at team level.
- Members opt-in raw transcript snippets for specific sessions; team server runs synthesis to compose cross-member case studies and pattern cards.
- Hybrid: pre-rendered sections for narrative spotlights, raw consent for case-study material.

The static prototype is intentionally produced **without binding to any of these**. Mock data is written as if a team-side LLM had composed the cross-member spotlights, so the prototype demonstrates the end-state. Phase 2's spec answers how the output actually gets generated.

## 4. Data-mining inventory (Tier mapping)

Maps directly to the personal-edition `WeekDigest` type defined in `packages/entries/src/types.ts`.

### 4.1 Tier 1 — automatic

| Source field | Notes |
|---|---|
| `agent_min_total`, `outcome_mix`, `helpfulness_sparkline`, `top_flags`, `top_goal_categories` (minutes), `concurrency_peak_day`, `days_active[]`, `busiest_day`, `hours_distribution[24]` | Numeric / taxonomy distribution |
| `working_shapes[].shape` + `.outcome_distribution` | Shape labels are taxonomy from `WorkingShape` |
| `interaction_modes.{orchestration, skill_use, plan_gating, turn_shape}` numeric fields | Drop `examples[]` and `prompt_preview` fields |
| `interaction_grammar.communication_style.{verbosity_distribution, steering}` | Distributions + counts |
| `projects[].{name, display_name, agent_min, share_pct, shipped_count}` | Project names default-share; member can mark private |
| User-authored skill **names** (no `sample_prompt_preview`) | Name describes harness shape |
| User-authored subagent type **names** (no `sample_description`, no `sample_prompt_preview`) | Same |
| `outcome_day`, `helpfulness_day` per day | Day-level rollup labels |

### 4.2 Tier 2 — opt-in

| Source field | Notes |
|---|---|
| `headline`, `key_pattern`, `trajectory[].line`, `standout_days[].why`, `day_signature` | LLM-generated prose |
| `what_worked`, `what_stalled`, `what_surprised`, `where_to_lean` (each with `evidence.quote`) | LLM-generated, with embedded quotes |
| `shipped[].title` | User-authored PR title text |
| `top_sessions[]` (entire field — `session_summary`, `steering_summary`, `pins[].label`, `evidence_first_user`, `evidence_subagent.prompt_preview`, `top_tools` with Bash sub-verbs) | Densest prose surface — single coarse opt-in toggle for the whole array |
| `friction_categories[].examples[].quote` (legacy) | Verbatim user/agent quotes |
| `interaction_modes.*.examples[].prompt_preview` and `.first_user_preview` | Raw prompt text |
| `interaction_grammar.user_authored_subagents[].sample_prompt_preview`, `.sample_description` | Raw prompt text |

## 5. Personal-edition opt-in page — `/team-share` (Phase 2)

> Designed here for completeness. Implementation is Phase 2.

New route in `apps/web/app/team-share/page.tsx`. Sidebar surfaces this only when `~/.cclens/team-config.json` exists (the file the team-server signup flow already writes, with `team_slug` + `bearer_token`).

### 5.1 Layout

```
─────────────────────────────────────────────────
Team: Acme Eng · acme.fleetlens.io
─────────────────────────────────────────────────
What we send automatically (Tier 1, numbers only)
  ▾ Sample preview         (read-only — exact fields, no toggles)

This week's submissions to the team report
  Week of 2026-05-11 (current)

  ☐ Narrative summary               (headline + trajectory + standout days)
     [preview pane]

  ☐ What worked / stalled / surprised
     [preview pane]

  ☐ Shipped work                    (PR titles + linked projects)
     [preview pane]

  ☐ Top session deep-dives          (highest sensitivity — full prose)
     [preview pane]

  [✓ Remember my choices for future weeks]
  [Submit this week]

─────────────────────────────────────────────────
Private projects (never share, any tier)
  + Add project path…
  ─ /Users/charlie/secret-thing
─────────────────────────────────────────────────
History
  · Week of 2026-05-04 — submitted: Narrative, Shipped
  · Week of 2026-04-27 — submitted: nothing
  …
```

### 5.2 Four opt-in section groups (UX-coarsened)

The personal `WeekDigest` has ~15 narrative fields; presenting them as 15 toggles would overwhelm. Four coarse groups, each with its own preview pane:

1. **Narrative summary** — `headline`, `key_pattern`, `trajectory`, `standout_days`, `day_signature`
2. **What worked / stalled / surprised** — `what_worked`, `what_stalled`, `what_surprised`, `where_to_lean`
3. **Shipped work** — `shipped[].title` and the associated project context
4. **Top session deep-dives** — entire `top_sessions[]` array (highest sensitivity)

If Phase 2 settles on the raw-transcript submission model instead of pre-rendered sections, these four groups remain the unit of consent but the preview pane shows the synthesized output that *would result* from a team-side LLM run over the raw data — preview-before-consent still applies.

## 6. Team-edition weekly report — `/team/[slug]/insights` (Phase 1, this spec)

### 6.1 Route + access

- Path: `/team/[slug]/insights`
- Auth: same `fleetlens_session` cookie + membership check as the existing roster page. Both admins and members can view.
- Layout wrapper: re-uses the team layout in `packages/team-server/src/app/team/[slug]/layout.tsx`.
- Sidebar: a new "Insights" entry above the existing Roster link.

### 6.2 Page sections (top to bottom)

1. **Team Pulse** (Tier 1)
   - Combined agent-hours + WoW delta
   - Shipping count + WoW delta
   - Members-active count (e.g., 4 of 5)
   - Outcome mix stacked bar (shipped / partial / exploratory / blocked / trivial)
   - Helpfulness mix stacked bar (essential / helpful / neutral / unhelpful)
   - Concurrency peak day

2. **How the team worked** (Tier 1)
   - Working-shape distribution across the team, as horizontal bars: `spec-review-loop ×4 across 3 members` style.
   - Goal-category minute mix (`build 42% · debug 18% · refactor 14% · plan 12% · …`).
   - Plan-mode adoption count (members who used Plan Mode at least once).
   - Brainstorm-warmup adoption count.

3. **Tools, skills, and harness** (Tier 1, names included)
   - Top tool families across the team (`Bash ×321 · Edit ×184 · Write ×72 · …`).
   - User-authored skills appearing this week, each row: `{name, members_using, total_uses}`. This is the "harness diffusion" view — the spec's primary surface for the "showcasing how the team uses agents" goal.
   - User-authored subagent types same shape.

4. **Projects** (Tier 1)
   - Per-project rows: project name, agent-min, members involved, shipped count. Cross-team — a project worked on by two members shows both. Useful for managers tracking which projects are absorbing the most agent time.

5. **Spotlights** (Tier 2, opt-in content)
   - Stack of cards, one per submitted spotlight this week. Card header: `From {member display name} · {section type}`. For team-synthesized cross-member cards: `From the team`.
   - Three flavors the prototype must demonstrate:
     - **Cross-team pattern.** A narrative card that ties together multiple members' work around a single working-shape, skill, or harness move. E.g., *"Three teammates independently reached for `spec-review-loop` this week. Charlie's variant pinned a reviewer-triad on the spec; Alice's compressed it into a single pass before merge; Bob added a follow-up sweep. Same shape, three textures."*
     - **Individual case study.** A 2-3 paragraph deep-read of one member's week, written second-person about that member but addressed to the team-as-audience. Designed to generate "I want to ask Bob about this" reactions.
     - **Strength surfacing.** A card that points at a specific move by a specific member worth elevating: *"Alice's `harness-orchestrate` skill bears watching — it's the only place in the team where parallel subagent dispatches consistently shipped without rework. Worth a Friday demo."*
   - Empty state when no spotlights this week: a clear explainer pointing to `/team-share` in the personal edition with a copyable instruction.

6. **Roster snapshot** (Tier 1, navigational)
   - Slim per-member rows: display name, agent-hours, shipped count, link to existing `/team/[slug]/members/[id]` page for the 1:1-prep drill-in.
   - The team report is **not** a replacement for the per-member detailed view — it's a complement. Managers prepping for a 1:1 go to the per-member page (or, ultimately, the member's personal edition if they have access). The team report's role is the team-level story.

7. **Footer** (Phase 1: static)
   - Generation timestamp (mocked).
   - Disabled prev/next nav (functional in Phase 2 when past digests persist).

## 7. Data flow architecture

### 7.1 Today

```
personal CLI daemon → POST /api/ingest/metrics       → daily_rollups
                    → POST /api/ingest/usage-history → plan_utilization
```

### 7.2 Phase 2 (sketch — designed in follow-up spec)

```
personal week-digest pipeline (apps/web side, on digest write):
  1. Compute Tier-1 rollup payload from the just-written WeekDigest
     (filter to Tier-1 fields, strip private-project entries)
  2. Read per-section opt-in choices from settings
  3. Bundle Tier-2 spotlight payloads OR raw-transcript payloads
     (decision deferred to Phase-2 spec) for each opted-in section
  4. POST → /api/ingest/week-digest  (new endpoint)
  5. Result stored in two new tables (sketch):
       team_week_rollups     (PK: team_id, membership_id, week_monday)
       team_week_spotlights  (PK: team_id, membership_id, week_monday, section_type)
     If raw-submission model: a third table for transcript payloads, plus
     a team-side synthesizer that produces spotlight rows.

team-server /team/[slug]/insights render:
  1. SELECT team_week_rollups WHERE team_id=? AND week_monday=?
  2. SELECT team_week_spotlights WHERE team_id=? AND week_monday=?
  3. Aggregate rollups deterministically (cross-team counts).
  4. Render page from aggregates + spotlights.
```

The Phase-2 spec answers: submission unit (raw vs pre-rendered vs hybrid), team-side LLM placement and cost, schema details, preview-before-consent UX for the raw-submission case.

## 8. Phase 1 — static prototype scope (this spec's deliverable)

### 8.1 What ships in Phase 1

- New route `packages/team-server/src/app/team/[slug]/insights/page.tsx` rendering hardcoded mock data covering all six page sections.
- New components in `packages/team-server/src/components/`:
  - `TeamPulse`
  - `WorkingShapeDistribution`
  - `HarnessDiffusion`
  - `ProjectsTable`
  - `SpotlightCard` (one component, branches on spotlight flavor)
  - `RosterSnapshot`
- Sidebar link added in `packages/team-server/src/app/team/[slug]/layout.tsx`.
- Mock data centralized in one file (e.g., `packages/team-server/src/app/team/[slug]/insights/mock-data.ts`) shaped to look like the eventual ingest payload — so Phase 2 can swap a fetcher function without UI changes.

### 8.2 What does **not** ship in Phase 1

- No DB migrations.
- No new ingest endpoints.
- No personal-edition changes (no `/team-share` page, no settings additions, no digest-write hook).
- No prev/next week navigation (disabled buttons).
- No real-time refresh (mock data is static).
- No empty-state variant of the page — the prototype is the populated state.

### 8.3 Storytelling requirement for mock data

The prototype is the persuasive artifact this spec exists to produce. Mock data must read like a real synthesized team report, not a placeholder. Concretely:

- **Pulse numbers** must be plausible for a 4-5 person engineering team running multi-agent fleets (10-25 combined agent-hours, 4-8 PRs shipped, etc.). Not "Lorem ipsum 99999."
- **Working-shape distribution** must reference real `WorkingShape` taxonomy values from `packages/entries/src/types.ts` and tell a coherent story (e.g., the team leaned hard on `spec-review-loop` this week).
- **Harness diffusion** must include 2-3 plausibly-named user-authored skills and show non-trivial adoption patterns (e.g., one skill used by 3 members, one by just the author).
- **Projects** must include 3-4 plausible project names with mixed authorship.
- **Spotlights** must demonstrate all three flavors (cross-team pattern, individual case study, strength surfacing) with prose long enough to feel like a real synthesized narrative — not one-liners.
- **Roster snapshot** must show all members from the pulse's "members active" count, with consistent numbers.

A reviewer reading the rendered prototype should come away with a strong intuition for what the team report will say *when it actually works*, and a clear sense of what Phase 2's synthesis pipeline must produce.

## 9. Open questions

Tracked here so they aren't lost between this spec and Phase 2.

1. **Submission unit + team-side LLM placement.** The headline Phase-2 question. Drives everything else in the data flow.
2. **Per-member granularity of new Tier-1 rollups.** Today's `daily_rollups` already carries per-member agent-time / sessions / tools / turns / tokens, and a manager sees those on the existing per-member page. The new Tier-1 fields (per-member working-shape distribution, goal-category mix, plan-mode adoption, harness use) are counts and labels — keylogger-test clean — so by default they're also per-member visible. Phase 2 confirms this on a field-by-field basis and decides whether any of them should aggregate-only.
3. **Spotlight expiry.** Past weeks' spotlights stay visible forever, or rotate out after N weeks? Default proposed: keep forever (mirrors personal-edition past-digest immutability). Decide in Phase 2.
4. **Manager view of teammate's personal week digest.** Out of scope. The personal edition stays personal. Cross-edition viewing is a separate product question.
5. **Sticky-default UX.** "Remember my choices for future weeks" needs design — does it persist across weeks until explicitly unchecked, or expire after N weeks of no review? Decide in Phase 2 along with the opt-in page itself.

## 10. Glossary cross-reference

These existing types are referenced throughout:
- `WeekDigest`, `WorkingShape`, `DayOutcome`, `DayHelpfulness` — `packages/entries/src/types.ts`
- `dailyRollups`, `memberships`, `teams` — `packages/team-server/src/db/schema.ts`
- Existing team UI: `packages/team-server/src/app/team/[slug]/{page.tsx, layout.tsx, members/, plan/, settings/}`
- Existing personal week digest UI: `apps/web/app/insights/page.tsx`, `apps/web/components/week-digest.tsx`
