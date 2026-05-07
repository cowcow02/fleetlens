---
name: filing-fleetlens-issues
description: Use when the user asks to file, log, track, open, or backlog a GitHub issue for a Fleetlens enhancement, bug, or chore. Applies when capturing work for future handoff to an implementation agent rather than doing it inline in the current session.
---

# Filing Fleetlens Issues

## Overview

Issues in `cowcow02/fleetlens` are written to be **agent-ready**: a subagent or future Codex session should be able to pick one up and ship it without a follow-up conversation. This skill enforces a consistent structure and label taxonomy so the roadmap stays legible and handoffs are clean.

## When to Use

- User says "file an issue", "log this", "create a ticket", "add to backlog", "let's track this", "we should eventually do X"
- Capturing work for asynchronous / future execution
- Converting a chat idea into a trackable roadmap item

## When NOT to Use

- Micro-fixes you can finish in the current session — just do them
- Exploratory "what if" discussion — confirm user intent before filing
- Conversation-scoped TODOs — use TodoWrite instead

## Issue Body Template

Every issue body MUST have all four sections. Omit any and it stops being agent-ready.

```markdown
## Why
<1–2 lines: motivation, user value, or signal that prompted this>

## Scope
<files / packages touched — parser / web / cli / daemon — with paths if known>

## Acceptance
- [ ] <testable criterion>
- [ ] <testable criterion>

## Out of scope
- <explicit exclusion to prevent drift>
```

## Title Rules

- Verb-first, lowercase, scope-named: `add rule-based insights panel to dashboard`
- ≤ 70 characters
- No trailing period
- Avoid adjectives ("better", "nicer") — state the concrete change

## Labels

Always apply **one** `type:*`, **at least one** `area:*`, and **one** `size:*`. Add `agent-ready` only if the spec is tight enough for an implementation agent to finish unsupervised — if in doubt, leave it off.

| Label group | Values |
|---|---|
| `type:*` | `feat`, `fix`, `chore`, `docs` |
| `area:*` | `parser`, `web`, `cli`, `daemon` |
| `size:*` | `s` (<1hr), `m` (half day), `l` (multi-session, usually needs a plan first) |
| flag | `agent-ready` (optional; reserve for `s`/`m`) |

## Command

```bash
gh issue create \
  --title "add rule-based insights panel to dashboard" \
  --body "$(cat <<'EOF'
## Why
One-line motivation.

## Scope
- path/to/file.ts
- another/path.tsx

## Acceptance
- [ ] criterion 1
- [ ] criterion 2

## Out of scope
- explicit exclusion
EOF
)" \
  --label "type:feat,area:parser,area:web,size:m,agent-ready"
```

After filing, print the URL gh returns so the user can click through.

## Common Mistakes

- **Vague acceptance criteria** ("make it nicer", "improve UX") — rewrite until a machine could check pass/fail
- **Missing "Out of scope"** — without it agents drift into adjacent refactors
- **Bundling multiple concerns** — split into separate issues before filing
- **`agent-ready` on `size:l`** — `l` almost always needs a written plan first; strip the label
- **Raw paste of a chat idea** — always translate into the four-section template, even if the chat already covered the same points
- **Titles starting with nouns** ("Dashboard insights") — rewrite verb-first ("add dashboard insights")

## Red Flags — Stop and Reconsider

- You're about to use "improve", "better", "refactor X" with no acceptance criteria → not agent-ready
- The Scope section lists >5 files across >2 packages → probably needs splitting
- You can't think of anything to put in "Out of scope" → you haven't scoped it enough
