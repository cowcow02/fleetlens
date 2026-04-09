# @claude-sessions/parser

Parse [Claude Code](https://claude.com/claude-code) JSONL transcripts into structured event streams — with analytics and presentation helpers for building dashboards.

## Install

```bash
pnpm add @claude-sessions/parser
```

## Usage

### Parse raw JSONL lines

```ts
import { parseTranscript } from "@claude-sessions/parser";

const lines = rawJsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l));
const { meta, events } = parseTranscript(lines);

console.log(meta.totalUsage); // { input, output, cacheRead, cacheWrite }
console.log(events[0]?.preview); // one-line summary of the first event
```

### Read sessions from `~/.claude/projects/` (Node)

```ts
import { listSessions, getSession } from "@claude-sessions/parser/fs";

const recent = await listSessions({ limit: 50 });
const detail = await getSession(recent[0].id);
```

### Transform into presentation rows for a transcript UI

```ts
import { buildPresentation, buildMegaRows } from "@claude-sessions/parser";

const rows = buildPresentation(events); // noise hidden, tool calls merged
const megaRows = buildMegaRows(rows); // collapse agent loops into turns
```

### Compute dashboard analytics

```ts
import {
  dailyActivity,
  detectParallelRuns,
  highLevelMetrics,
  groupByProject,
} from "@claude-sessions/parser";

const buckets = dailyActivity(sessions); // one entry per day, for heatmaps/charts
const runs = detectParallelRuns(sessions); // periods where multiple sessions ran in parallel
const projects = groupByProject(sessions); // per-project rollups
const overall = highLevelMetrics(sessions);
```

## What it handles

- **Split-block assistant responses** — Claude Code writes one JSONL line per content block, but the same `message.id` carries identical `usage` on every line. The parser dedupes by `message.id` so totals aren't double-counted.
- **Out-of-order timestamps** — Attachments can flush after their triggering event with an earlier timestamp. The parser uses `min(ts)` as the session start instead of the first line's timestamp.
- **Consecutive tool calls** — `buildPresentation` merges them into a single `tool-group` row so `Bash → Grep → Read → Edit` reads as one compound action.
- **Task-notification codas** — When `gh pr create` runs in background and the agent replies "Acknowledged" afterward, `buildMegaRows` skips the coda and picks the real conclusion.
- **Slash commands / skill injections** — Recognized and optionally hidden from the user-message stream.

## Exports

- `@claude-sessions/parser` — types, parser, presentation, analytics (pure)
- `@claude-sessions/parser/fs` — filesystem scanner (node:fs only)

## License

MIT
