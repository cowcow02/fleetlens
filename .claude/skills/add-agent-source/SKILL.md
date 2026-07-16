---
name: add-agent-source
description: Use when adding support for a new coding agent/CLI as a Fleetlens session source (e.g. OpenCode) — the parser adapter, source registry, display metadata, tests, and optional usage poller. This is the canonical community extension task.
---

# Add a new agent source

## Shape of the task

A source is (1) a pure parser adapter that turns one line/record of the
agent's on-disk transcript format into a `SessionEvent`, (2) a registry entry
telling the filesystem scanner where transcripts live, and (3) a metadata
entry for how the agent is displayed. Everything downstream (sessions list,
analytics, concurrency, projects, dashboard) works automatically once events
are normalized.

## Steps

1. **Study the nearest existing adapter** in `packages/parser/src/`:
   `codex.ts` (rollout-file style), `gemini.ts` (chat-file style),
   `grok.ts`, `antigravity.ts`, `cowork.ts`. Pick whichever on-disk format is
   closest to the new agent's. `claude-code.ts` is the richest reference for
   what a fully-populated `SessionEvent` looks like (`types.ts` has the type).

2. **Write `packages/parser/src/<agent>.ts`** — pure TypeScript, no `fs`, no
   network (the parser package is browser-safe; all filesystem access lives
   in `fs.ts`). Map timestamps, roles, tool calls, token usage, model names,
   and `cwd` faithfully; `cwd` drives project identity. If the agent spawns
   subagents, emit `session_kind: "subagent"` so those sessions attach under
   their parent instead of flooding the sessions list.

3. **Register the source** in `packages/parser/src/fs.ts` — add to the
   `agentSources` array (transcript root, e.g. `~/.<agent>/sessions`, plus
   discovery/parse hooks following the existing entries).

4. **Add display metadata** in `packages/parser/src/agent-metadata.ts`
   (id, display name, badge mark, color) — this is what the dashboard,
   filters, and usage badges render.

5. **Tests** in `packages/parser/test/` mirroring the existing per-source
   suites. Fixtures MUST be fictional — invent paths, project names, and
   prompts (`orbit-shop` house style). Never paste real transcript lines
   containing employer/customer names; a privacy scrub of leaked fixture data
   cost this repo a full audit round.

6. **Verify end-to-end**: `pnpm -F @claude-lens/parser test`, then the
   `dev-loop` skill — confirm the source appears in `/sessions?agent=<id>`,
   overview counts, and a session detail page renders from a real local
   transcript if you have one.

7. **Docs**: add the source to the "Supported local sources" table in
   `site/reference.html` and a CHANGELOG entry (release gate requires it).

## Usage polling is separate

Plan-utilization polling (the `/usage` page, menu bar) is not part of the
parser. Only add it if the provider exposes a quota API: poller in
`packages/cli/src/usage/` (see `codex.ts`, `grok.ts`, `zai.ts` there), wired
into the daemon. A transcript source without usage polling is a complete,
shippable contribution.
