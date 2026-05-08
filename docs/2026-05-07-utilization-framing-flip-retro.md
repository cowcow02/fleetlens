# Retro — Plan utilization framing flip

**Date:** 2026-05-07
**Branch:** `feat/utilization-flip`
**Demo URLs (worktree-local):**
- Personal: `http://localhost:4477/usage`
- Team: `http://localhost:4488/team/demo-team/plan` (admin: `demo-admin@example.com` / `demo1234`)

## What changed

The whole "plan utilization" surface treated low usage as the safe state
and high usage as the risky one — green at the bottom, red at the top of
every gauge, "behind schedule" / "at risk" labels for high-burn members.

That framing is backwards. Paying for Claude Pro Max 20x at $200/mo and
peaking at 25% means you're paying for headroom you're never going to
touch. Hitting 90% is the *goal* — that's what success looks like.

Everything that signals utilization now flips on this premise:

| Signal | Old | New |
|---|---|---|
| Cycle peak ≥70% | 🔴 / 🟡 "at risk" / "trending hot" | 🟢 "fully utilizing" |
| Cycle peak 40–69% | 🟢 "on track" | 🟡 "moderate use" |
| Cycle peak <40% | 🟢 "on track" | 🔴 "underutilizing" |
| Burndown over-pace | 🔴 "behind schedule" | 🟢 "on pace" |
| Burndown under-pace +5pp | 🟢 "on track" | 🟡 "underutilizing" |
| Burndown under-pace +20pp | 🟢 "on track" | 🔴 "barely used" |
| Burndown far-over-pace −50pp | 🔴 "behind schedule" | 🔴 "outpacing" *(stays red — will exhaust before reset)* |
| `downgrade` recommendation | 🟢 "saving money" | 🔴 "paying for unused headroom" |
| Plan page header | "X at risk · Y trending hot" | "X underutilizing · Y fully utilizing" |
| Bottom danger bands on burndown chart | 🔴 / 🟡 strips at 0–10% / 10–30% remaining | *removed* — that band is now the goal zone |

Throttling stats (real wall-hits) stay red regardless. They're a
distinct signal: getting blocked is bad in any framing.

## How it's structured

Two new helper modules — one per edition — own the thresholds:

- `apps/web/lib/utilization-tone.ts`
- `packages/team-server/src/lib/utilization-tone.ts`

Both export `utilizationTone(pct)`, color helpers, and `paceLabel(delta)`
returning `{ tone, label }`. Thresholds (`good: 70`, `low: 40`) live in
exactly one place per edition. Future tuning is a single-line change.

The personal helper uses CSS vars (`var(--af-success)`); the team
helper uses raw hex (`#2c6e49`) because the team-server's stylesheet
doesn't ship those vars. The thresholds are the only logic worth
sharing and they're trivial — keeping two files keeps the import graph
clean (no cross-app shared lib for 5 lines of constants).

Files touched:

- `apps/web/components/usage-chart.tsx` — pace label + removed danger bands
- `apps/web/components/previous-cycles-trend.tsx` — bar colors
- `apps/web/components/usage-gauges.tsx` — fill color
- `apps/web/components/usage-sidebar.tsx` — fill color
- `packages/team-server/src/components/cycle-peaks-strip.tsx` — bar colors
- `packages/team-server/src/components/member-burndown-chart.tsx` — pace label + removed bands
- `packages/team-server/src/components/member-plan-block.tsx` — `downgrade` tone flip
- `packages/team-server/src/components/optimizer-card.tsx` — `downgrade` tone flip
- `packages/team-server/src/app/team/[slug]/plan/page.tsx` — header pill counts + per-row status labels

Added `scripts/seed-team-demo.mjs` for spinning up a local team-server
with a representative team (4 members spanning all three buckets +
at-the-cap). Self-contained — replays the migration journal directly,
no dependency on the team-server's compiled output.

## What I went back-and-forth on

**Whether to add a "going to exhaust early" red zone on the over-burning
side.** Initially leaned toward "no, the user explicitly said 'use it
all, that's the point.'" But hitting 0% with 4 days left is throttled,
not victorious. Settled on: `delta < -50` flips back to danger
(`"outpacing"`), the rest of the over-burn region stays green. Both
extremes are bad; the sweet spot is centered.

**Whether to remove the static danger bands or invert them.** Inverting
would mean a faint "wasted" band at the *top* of the chart. But that
band would always show, even at the start of a cycle when high
remaining is the only correct state — context-blind. Static positional
bands don't fit a time-aware framing. Removed.

**Whether to consolidate the two `utilization-tone.ts` files into a
shared `@claude-lens/parser` export.** Both editions hold the *same*
threshold values, so there's a coupling here. But the personal edition
uses CSS vars for color; the team-server uses hex literals. Sharing the
threshold constants saves five lines and creates a cross-package
dependency. Not worth it. If thresholds drift between editions, both
files are next to each other in the diff — easy to spot.

## What still needs daily_rollups seeded to fully demo

The team-server's recommendation engine (`stay`/`downgrade`/`upgrade`
pills in the member detail header) needs ≥14 days observed in
`membership_weekly_utilization` before it fires. The seed script only
populates the in-progress 7-day cycle, so demo members show
"Collecting data" instead of the actual recommendation tone. The
*flip itself* is fully visible — the burndown pace label, cycle peak
bars, and plan-page header all render correctly.

If we want to fully exercise the recommendation pill in future demos,
extend the seed to populate snapshots across 4+ prior weeks. Out of
scope here — the visual flip is what was asked for.

## Why this matters beyond aesthetics

The dashboard reading is the financial story. With the old framing, a
team paying $800/mo for 4 Claude Max seats and using 20% of capacity
saw a green dashboard and felt good about it. With the new framing,
that's red — exactly the prompt to consider downsizing two of the
seats. The same numbers, the same code path, an inverted prompt to
the operator. That's the whole point.

## Tests

- `pnpm typecheck` — passes (7/7).
- `pnpm test` — passes (424/424). Cycle-peaks dedup tests in
  `cycle-peaks.test.ts` don't touch color, so no regen needed.
- Visual smoke — both editions screenshotted on the worktree-local
  dev servers; flip works as designed across all three buckets.
