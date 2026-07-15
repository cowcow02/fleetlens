# Manual review of W16 + W17 vs auto-generated digest

**Source:** Hand-read of cached Entry data (`~/.cclens/entries/`) for 2026-04-13 → 2026-04-26, cross-referenced against the auto-generated week digest (`~/.cclens/digests/week/2026-04-{13,20}.json`).

**Purpose:** Identify the qualitative texture the auto-digest is missing so the product can be improved.

---

## W16 (2026-04-13 → 2026-04-19)

### What I see in the data

You opened the week with a research-then-build move on Mon: 168704e8 dispatched three Explore subagents at github.com/ryoppippi/ccusage, usage4claude, and claude-meter to understand how each one extracts Claude Code plan-utilization data — *before* writing any of the dashboard. That's a deliberate "study what works, then build" pattern, not a default.

You also opened that day with an image-driven prompt (`[Image #5] for long pending session worthy to convert into hours?`) — visual cue → quantitative ask.

By Wed (04-15), you'd shifted into the **spec → review → re-review → implement** loop on b4b14c03 (Team Orchestration View, 27 subagent dispatches): general-purpose "Review team spec doc" → general-purpose "Review full plan document" → general-purpose "Re-review revised plan". Three review rounds before code. Same pattern reappears on e80b3554 the following week.

Thu (04-16) on 4ee3345c was the most concentrated chunk-implementation session of the week: 21 subagent dispatches in a 34-minute span with 63 TodoWrite ops — "Implement Task 1: Initialize team-server package", "Implement Task 2: Database schema", "Implement Task 3: Crypto utilities". You'd handed off four spec docs and let the subagents shred-and-build, while the parent session orchestrated.

The agentic-knowledge-system days (0b224018) used **project-specific harness skills** — `harness-orchestrate-retrospective`, `cloud-verify`, `harness-orchestrate-merge`. These are skills you authored, not stock superpowers. The auto-digest has no idea these are first-class user-built tooling.

Friday's friction was specifically a Railway CLI permission stall on 231de74c: "Agent paused to verify Railway CLI and web UI access instead of proceeding". The session was a setup task (railway-railway-docs skill loaded), and the agent treated tool authority as something to verify rather than assume.

### Good things (W16)

1. **Research before commitment** — three GitHub-explore subagents on Mon before building the dashboard. This is rare discipline and the auto-digest never named it.
2. **Multi-round spec/plan review** — every major shipping day this week had at least 2 rounds of subagent review before implementation. The Team Orchestration View shipped clean because of this. The auto-digest mentioned "subagent dispatches" generically, missing that the *type* of dispatch (reviewer vs implementer) is the signal.
3. **Aggressive task decomposition with TodoWrite** — 63 TodoWrite ops on 4ee3345c during a 21-subagent run. You're using the task layer as the orchestration substrate, not just a checklist.
4. **Project-specific harness skills.** `harness-orchestrate-retrospective`, `cloud-verify`, `harness-orchestrate-merge` — you've built skills that codify *your* workflow. The fact that `harness-orchestrate-retrospective` exists at all means you've automated retrospective patterns the same way Fleetlens is supposed to surface them.
5. **Image-driven prompts** for visual-grounded asks. The Mon dashboard work opened with a screenshot of a pending session.

### How each could be made better (W16)

1. **The research-then-build pattern is great but the research never landed in a CLAUDE.md.** Three subagents investigated ccusage/usage4claude/claude-meter; the synthesized findings ended up in the dashboard code but not in a "what we learned about plan-utilization data extraction" doc. That research is lost the next time someone (you, six months later) needs it.
2. **Spec-review subagents are reactive, not proactive.** "Review this spec" is good, but the subagents review post-hoc. Pre-commitment review — having a subagent challenge the spec's assumptions before you commit to writing it — would catch convention drift earlier (the "agent air time" → "non-idle time" correction on Mon would have been caught at spec time, not minute 90).
3. **Chunk-implementation needs an interface gate per chunk.** 4ee3345c's "Implement Task 1/2/3..." dispatches are powerful but operate in parallel. The user (you) became the only integration check. A reviewer subagent that *only* verifies the chunk-N output matches the chunk-(N-1) interface would close the gap between "all chunks shipped" and "the seams hold."
4. **TodoWrite is being used as orchestration but the tasks decay.** 63 TodoWrite ops in one session means most of those tasks finished and were forgotten. The auto-digest could capture which TodoWrite items repeated *across* sessions — those are the real recurring threads.
5. **The harness skills aren't being measured.** `harness-orchestrate-retrospective` ran but Fleetlens has no concept of "user-authored skill effectiveness". Worth instrumenting which skills consistently precede shipping vs blocking outcomes.

### Special things (W16)

- **The Tue daemon-fix is a power-to-weight outlier:** 7.5 minutes from "investigate" to shipped v0.2.8 with `essential` helpfulness. It's the contrast point for the rest of the week. The auto-digest noticed this. ✓
- **Cross-project orchestration on Thu (04-16):** four projects in 396 minutes (claude-lens timeline polish + vinuage + Team Edition spec + KB shipping). Each project had a different subagent strategy. The auto-digest just named the count.
- **"local-command-caveat" framing on b4b14c03 + 0609eb60.** You're prepending caveat blocks to your own prompts to disambiguate machine-generated input — that's a meta-tool you've built around Claude Code's prompt-injection surface area.

---

## W17 (2026-04-20 → 2026-04-26)

### What I see in the data

Mon (04-20) was a single 216-minute autonomous push on `vinuage-server` — f0808012 — with two upfront Explore subagents ("Explore FE ai-wine-assistant branch", "Explore BE ai-wine-assistant branch") + a `claude-code-guide` subagent for SDK research, then build. Same research-precedes-build pattern as W16's Mon. Skills loaded: `superpowers:brainstorming`, `superpowers:writing-plans`. Outcome `partial` because of a `FailedToOpenSocket` at the end of the staging push.

Tue (04-21) had two distinct interactions. The claude-lens session 1d3c1cd4 was **continuation** ("continue") of the previous day's retro pipeline build, ending blocked by `ConnectionRefused`. The agentic-knowledge-system session 198910c9 (ORB-183, sidebar settings) opened with a `<teammate-message teammate_id="team-lead">` — that's your **harness orchestration** sending the task in via a structured handoff format, with a background `general-purpose` env-setup subagent fired in parallel.

Wed (04-22) was the heaviest day: 647 minutes across multiple long sessions. e80b3554 (Phase 1b enrichment, 130m, 37 sub dispatches) ran the **spec → 3-pass review → implement** loop again — three "Review plan chunk N" subagents in sequence. 9688cea8 (V2 perception layer, 96m, 24 sub) included an `Explore` subagent reverse-engineering Anthropic's `/insights` slash command source code (`/Users/cowcow02/Repo/claude-code-source/src/`) — competitive analysis as a subagent task. 0368a77e (cold-cache indicator, 76m, 3 sub) ran three review subagents post-implementation: "Code reuse review" + "Code quality review" + "Efficiency review" — three different review lenses, parallel.

Thu (04-23) was effectively idle (1.3m).

Fri (04-24) was the team-server self-update sprint on 4884407b: 121 minutes, 14 subagent dispatches, 22 TodoWrite ops. The dispatches were chunk-implementation: "Implement Chunk 1: RBAC foundation" → "Spec-review Chunk 1" → "superpowers:code-reviewer: Code-quality review Chunk 1". A more rigorous shape than W16's Thu — each chunk got both a spec-compliance review *and* a code-quality review (the `superpowers:code-reviewer` agent — a stock superpowers reviewer, not a one-off general-purpose).

Sat (04-25) was Phase 2 merge + ahora v8 spec drafting (2d445de7, 99m, 9 sub on ahora; 6a6ac924, 52m, 0 sub for a CLI utilization pipeline). The ahora session opened with `superpowers:brainstorming` (×6 across the day), heavy planning mode.

### Good things (W17)

1. **You're matching reviewer-type to review-purpose.** On 0368a77e you used three *different* general-purpose dispatches for three lenses (reuse / quality / efficiency). On 4884407b you used `superpowers:code-reviewer` (the stock reviewer) for code quality but kept general-purpose for spec compliance. That's a mature signal — you know the reviewers aren't fungible.
2. **`claude-code-guide` and `Explore` subagents for competitive analysis.** Reverse-engineering Anthropic's own /insights slash command via subagent (9688cea8) is the kind of move most users wouldn't think to delegate. The parent session stayed productive while the subagent dug.
3. **`brainstorming` skill anchored every design-day opener.** Mon vinuage, Wed perception V2, Sat ahora spec — all opened with `superpowers:brainstorming`. Skill-as-warmup ritual.
4. **TodoWrite at industrial scale.** 469 task ops across the week (50+ on Wed alone). The TodoWrite-as-state-machine pattern is fully internalized.
5. **The `<teammate-message>` harness on ORB-183.** Your agentic harness handoff format is genuinely a new abstraction — you've built a coordinator/teammate role hierarchy on top of plain Claude Code subagents. The auto-digest has no vocabulary for this.

### How each could be made better (W17)

1. **Reviewer-type selection isn't yet codified.** You're picking general-purpose vs superpowers:code-reviewer correctly by feel, but a CLAUDE.md rule like "code-quality reviews → superpowers:code-reviewer; spec compliance → general-purpose; design coherence → claude-code-guide" would make it explicit and let subagent dispatchers (or future-you) make the call without re-deriving.
2. **Cross-session continuity is implicit.** 4884407b appeared on 04-22, 04-23 (1.3m), 04-24 (121m). Each session opened with a long handoff prose preamble copied from the previous session's output. That's a manual continuity protocol. A `harness-handoff` skill that *generated* the handoff prompt from the prior session's TodoWrite + final-agent text would automate it.
3. **No Plan Mode anywhere — but you're doing planning by hand.** 0 ExitPlan calls in 47 entries this week. You DO plan (brainstorming skill, plan-writing-via-spec, multi-pass review) but never use the canonical Plan Mode tool. Either Plan Mode doesn't fit your shape (likely — your plans are typically multi-doc, not single-prompt) or you've never needed it. Worth deciding deliberately: is Plan Mode a gap, or are you *post-Plan-Mode* in a way the harness should acknowledge?
4. **Connection / socket errors are 2-of-2 mid-week friction sources.** Mon vinuage staging push died on `FailedToOpenSocket`; Tue retro pipeline build died on `ConnectionRefused`. Both at the *end* of long autonomous runs. A "connection-error-recovery" hook that captures the last N tool calls + open files when a socket error fires would let the next session resume without re-deriving state.
5. **The competitive-analysis subagent (Anthropic /insights reverse-engineering) was one-shot.** That investigation produced findings that informed the V2 perception layer architecture — but the findings live in chat history, not in a doc. Same gap as W16's research-without-doc problem, recurring.

### Special things (W17)

- **The reviewer triad pattern on 0368a77e (cold cache shipping):** code reuse + code quality + efficiency, three reviewers in parallel before the diff merged. This is more rigorous than what most teams do at PR time.
- **The single 216-minute Mon push** is genuinely the longest single autonomous turn of either week — 789 tool calls in one push, mostly on the staging-prep phase. A real outlier.
- **The teammate-message harness on ORB-183 ran a background env-setup agent in parallel with the main thread.** Two subagents working on the same goal, one foreground (the implementing teammate) and one background (env setup). That's coordinator-style orchestration.

---

## Cross-week observations the auto-digest doesn't capture

**The Tue (04-14) daemon fix in W16 vs Tue (04-21) ConnectionRefused in W17.** Same day-of-week, opposite outcomes. Tue Apr 14 shipped clean in 7.5 min. Tue Apr 21 died at 70 min on connection error. Both were continuation-style sessions ("continue"). The difference: Apr 14 had a clear, scoped task; Apr 21 was the tail of an open-ended retro-pipeline build. The auto-digest can't see *across* weeks.

**The spec-review-loop pattern transfers.** W16's b4b14c03 (Team Orchestration spec) used 3-round review. W17's e80b3554 (Phase 1b plan) used 3-round review. W17's 4884407b (self-update spec) used 3-round review. This is YOUR signature methodology — and the auto-digest names it as "subagent dispatches" generically.

**TodoWrite intensity correlates with shipping.** W16 high-todo days (04-15: 57 todos / 04-16: 138 todos) shipped Team Orchestration View + Team Edition. W17 high-todo days (04-22: 165 todos / 04-24: 22 todos) shipped Phase 1b + self-update. Low-todo days were planning, exploration, or ConnectionRefused-blocked. The auto-digest reports the count but not the correlation with outcome.

**Skill-load patterns predict session shape:**
- `superpowers:brainstorming` → design / spec-writing day
- `superpowers:writing-plans` → planning day (often follows brainstorming)
- `superpowers:subagent-driven-development` → chunk-implementation day
- `mcp__claude-in-chrome__*` → visual smoke / shipping day
- `harness-orchestrate-*` (your own) → KB project days

The auto-digest names skills by count but doesn't decode the *shape* each skill predicts.

---

## What this means for the product

### Things the auto-digest currently does well
- Numeric mode aggregation (subagent counts, skill counts, plan-gating absence) — useful as a snapshot.
- Friction quote substring-grounding — keeps the LLM honest about quotes.
- Threshold-clipping projects, W-over-W delta — readable.

### Where the auto-digest falls short of what's in the data
1. **It treats subagents as fungible.** "146 dispatches" is a number, not a portrait. The data has the actual subagent prompts AND the descriptions ("Review plan chunk 1", "Implement Task 2: Database schema") — these reveal the *shape* of orchestration. Right now the digest only sees `top_types` aggregated.
   - **Product fix:** the LLM should be able to identify orchestration *shapes* — "spec-review loop", "chunk-implementation", "competitive-analysis dispatch", "background env setup". This needs the prompt to ask for the SHAPE, not the count, and possibly a small classifier.
2. **It doesn't see user-authored skills as first-class.** `harness-orchestrate-retrospective` and `cloud-verify` are user-built tooling — they should be highlighted as the user's *own* abstractions, not lumped with stock superpowers skills. A skill being user-authored is a strong signal.
   - **Product fix:** at Entry-build time, distinguish user-authored skills (project-local) from stock skills (`superpowers:*`, `mcp__*`). Surface user-authored skill use as its own dimension.
3. **Cross-session continuity is invisible.** Multiple sessions sharing a session_id over multiple days, or different sessions with handoff-prose openers from a prior session — these are continuation patterns. The auto-digest treats them as separate Entries.
   - **Product fix:** detect handoff prose in `first_user` (e.g. `## Session conclusion — Phase 1A` or `# Handoff:` or `<teammate-message>`) and chain Entries that share a continuation thread. Surface the chain length + duration as a "thread" signal.
4. **No notion of orchestration *roles*.** The user's data shows reviewer subagents, implementer subagents, explorer subagents, env-setup background agents. The auto-digest just counts them.
   - **Product fix:** classify subagent dispatches by *role* (review / implement / explore / research / env-setup / coordination) using the description + prompt_preview. Aggregate by role, not just type.
5. **The "good things" are buried in flag noise.** "loop_suspected" is loud and present everywhere; the underlying signal — *was this loop a useful exploration or a stuck cycle?* — depends on outcome. A loop_suspected on a `shipped` day is a positive (long autonomous build). A loop_suspected on a `blocked` day is friction. The current digest doesn't distinguish.
   - **Product fix:** flag interpretation should be outcome-conditional in the prompt. "loop_suspected on shipped days = thoroughness; loop_suspected on blocked days = stuck loop."
6. **Prompt-frame patterns (`<teammate-message>`, `<local-command-caveat>`, handoff-prose openers) are invisible.** These are the user's interaction *grammar* with Claude. The digest never sees them.
   - **Product fix:** `signals.ts` could detect these prompt frames and surface them as a `prompt_frame_use` signal alongside skill loads.

### Concrete next-PR suggestions

1. Add `subagent_role` classification to Entry build (cheap rule-based: prompt_preview matched against verb regex — review/implement/explore/research/setup).
2. Add `is_user_authored_skill` flag at Entry build (skill name doesn't match `superpowers:` / `mcp__` / `frontend-design:` / `code-review:` / `codex:` prefixes → user-authored).
3. Add `prompt_frame` detection in signals.ts — `<teammate-message>`, `<local-command-caveat>`, `## Session conclusion`, `# Handoff:`, `[Image #N]`.
4. Add "thread continuity" detection — Entries whose `first_user` substring-matches the prior Entry's `final_agent` or contains a handoff frame; aggregate as a `thread` (chain of Entries).
5. Update the week prompt to ask for orchestration *shapes* (not counts), to call out user-authored skills explicitly, and to interpret flags as outcome-conditional.
6. Add a "Thread continuity" mode card to the four interaction-mode cards if any cross-session threads were detected.
