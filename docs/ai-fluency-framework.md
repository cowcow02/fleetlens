# AI Fluency Framework — Fleetlens edition

> A coding-agent-native adaptation of Anthropic's 4D AI Fluency framework, designed to be observed deterministically from JSONL transcripts across **every** coding agent in scope — Claude Code, Codex CLI, Gemini CLI, OpenCode, and any future source the parser registers.
>
> The thesis: Anthropic's own research found "iteration & refinement is the strongest predictor of good AI use" and "polished outputs like artifacts and code tended to lower critical checking." For coding agents — *the* polished-artifact agents — that is the central paradox. The Fleetlens AI Fluency Report measures whether your team is maintaining critical engagement as Claude's output gets more polished, and how their collaboration practice is maturing over time.

---

## The 11 axes

Three pillars, eleven observable behaviors, ranked **+** (Demonstrated) / **~** (Partial) / **−** (Not observed) per session × user × week.

### Delegation — set the task up well

| ID | Axis | What we look for |
|---|---|---|
| D1 | **Plan-gating** | Plan Mode invocation *or* a spec-review subagent dispatched before any implementation tool fires |
| D2 | **Scoping clarity** | First-turn user prompt names a definition-of-done (acceptance criteria, output shape, scope boundary) |
| D3 | **Reviewer-type matching** | Subagent dispatches route to the right reviewer (code-quality → code-reviewer; spec-compliance → general-purpose; design → claude-code-guide) |

### Description — give the agent what it needs

| ID | Axis | What we look for |
|---|---|---|
| De1 | **Context shoring** | Opening prompt references concrete files, prior PRs, design docs (not "look around and figure it out") |
| De2 | **Output shape specification** | Names the file, function signature, schema, or accepted example style up front |
| De3 | **Constraint surfacing** | First turn names known traps, invariants, anti-patterns to avoid |
| De4 | **Iterative refinement** | Multi-round revision evidence (≥3 user turns) vs ship-first-draft. *Anthropic's strongest predictor.* |

### Discernment — evaluate what comes back

| ID | Axis | What we look for |
|---|---|---|
| Di1 | **Skeptical review** | Questions agent claims, demands evidence, runs targeted tests against assertions |
| Di2 | **Verification at boundary** | Verify step (build/test/manual) exists *before* `gh pr create` or final merge |
| Di3 | **Rollback discipline** | Reverts/undoes when an approach is wrong, instead of patching over a broken direction |
| Di4 | **Context correction** | Proactively corrects the agent's mental model when it's off, rather than working around it |

### Rating scale

- **+ Demonstrated** — clear, repeated evidence within the window
- **~ Partial** — present but inconsistent or imperfectly executed
- **− Not observed** — no evidence within the window (and the session shape was one where evidence would be expected)
- **·** Not applicable (axis doesn't apply to this session's shape — e.g. Di2 doesn't fire on a research-only session)

Personal score = count of `+` over count of applicable axes (e.g. *8.5 / 11*, where `+` = 1.0 and `~` = 0.5).

---

## The Risk Triangle

Three failure modes derived from Anthropic's "polished output lowers critical checking" finding. Every session lands on a centroid in the triangle; the team's centroid moves week to week.

```
                Polish-without-check
                       ▲
                      / \
                     /   \
                    /     \
                   /       \
   Iterate-without-verify   Verify-without-iterate
            ◀─────────────────────▶
```

| Corner | Definition | Why it's a failure |
|---|---|---|
| **Polish-without-check** | Polished artifact output received zero verification turns | The Anthropic risk pattern — accepting Claude's polish at face value |
| **Iterate-without-verify** | Multiple iteration rounds but no external verification (build/test/PR review) before merge | Refined into a comfortable answer, never tested against reality |
| **Verify-without-iterate** | Verified once, shipped first draft anyway | Sanity check turns into rubber-stamping |

The team's collective position visualises the *centroid* of all session positions in the window. Movement toward the center = balanced practice maturing; drift toward a corner = the relevant risk increasing.

---

## Team-only dimensions

The framework adds value beyond N× individual scorecards through three team-scope-only dimensions:

### 1. Distribution
For each axis, what fraction of the team Demonstrated / Partial / Not-observed it this week, with delta vs the prior week. Replaces a single team score with axis-level resolution.

### 2. Pattern diffusion
When one engineer's habit shows up in another's transcripts within N days. Detected via:
- Shared CLAUDE.md edits preceding behavior shifts
- Identical prompt frames (`<teammate-message>`, `/harness-orchestrate`) appearing across engineers within a 7-day window
- Subagent dispatch descriptions matching previously-seen patterns from teammates
- Skill loads clustering temporally after one engineer surfaces a skill in a PR

Rendered as a Sankey-style flow showing seeder → adopter relationships per behavior.

### 3. Norms drift
4-week rolling trajectory per axis. Surfaces:
- Behaviors crossing 50% prevalence (becoming norms)
- Behaviors drifting below 30% (fading)
- Behaviors stable but at zero (pre-norms — opportunity)

---

## Privacy architecture

This is architectural, not a setting.

- **Manager view** (admins on `/team/[slug]/fluency`): only team-aggregate distributions, anonymised diffusion graphs (engineer A → B labels), Risk Triangle centroid, norms drift trajectory. **No per-engineer scorecards, no evidence quotes from anyone but yourself.**
- **Individual view** (any signed-in user on `/team/[slug]/fluency/me`): own scorecard, own evidence quotes, own growth axis suggestion. *Visible only to that user; not to admins.*
- **Highlight reel** (opt-in): an engineer can publish a single positive moment from their own scorecard to the team channel ("caught a hallucinated function signature on Wed session 0368a77e"). Negative observations are *never* publishable. Publication is per-moment, not per-account.

Two database surfaces enforce this — `fluency_observations` (private rows, indexed by member) and `fluency_team_aggregate` (the only thing manager queries can read).

---

## Cross-agent observation

The framework is **agent-agnostic by design**. Each axis maps to signals observable in any agent's JSONL transcript:

| Axis | Claude Code signal | Codex CLI signal | Gemini CLI signal |
|---|---|---|---|
| D1 Plan-gating | `ExitPlanMode` tool / spec-review subagent | `propose_change` mode entry | `--plan` flag use |
| D2 Scoping | First-turn regex for "acceptance / done / success" | same | same |
| D3 Reviewer matching | Subagent type vs description regex | N/A (no native subagents) — falls back to applied/not-applied | same |
| De1 Context shoring | `Read` calls *before* `Edit`/`Write` in first 5 turns | `apply_patch` referencing files mentioned in user input | `read_file` ahead of `write_file` |
| De2 Output shape | Regex on first-turn for file paths, signatures, schemas | same | same |
| De3 Constraint surfacing | First-turn regex for "do not", "avoid", "must", "invariant" | same | same |
| De4 Iterative refinement | ≥3 user turns within session | same | same |
| Di1 Skeptical review | User turn challenges claim ("are you sure", "show me") | same | same |
| Di2 Verify at boundary | Test/build tool call before `gh pr create` | `shell` calls matching test patterns | same |
| Di3 Rollback discipline | `git revert` / removal of prior `Edit`'s file | same | same |
| Di4 Context correction | User turn correcting prior agent statement ("no, that's wrong because…") | same | same |

The Fleetlens parser package already normalises events across these three agents; observation runs over the normalised `SessionEvent[]` shape.

This is the structural advantage over Anthropic's own scorecard: Fleetlens isn't limited to Claude. A team running Codex *and* Claude Code, or piloting Gemini alongside, gets a single fluency report that captures their *collaboration practice*, not their loyalty to one vendor.

---

## Why this is more than a copy of Anthropic's

| | Anthropic Personal AI Fluency Scorecard | Fleetlens AI Fluency Report |
|---|---|---|
| Scope | One user, Claude only | One team, any agent |
| Surface | Settings panel | Dedicated weekly report |
| Aggregation | 30-day rolling | Per-week + 4-week trajectory + diffusion graph |
| Team-level patterns | None | Distribution, diffusion, norms drift, Risk Triangle |
| Coaching coupling | None (Anthropic Academy is a separate product) | Per-engineer growth axis + team norm proposals |
| Verifiability | Quotes ≤ 150 chars | Verbatim transcript links + session jump-to (own data only) |
| Privacy | User-private | Architectural manager/individual split + opt-in highlight publishing |
| Lock-in | Claude-bound | Agent-agnostic |

---

## Phase plan

This document drops in PR #(this one) alongside the showcase prototype. Phase 2 wires the observation layer into the daemon and team-server. See the Phase 2 task in the PR description.
