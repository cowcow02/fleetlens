# In-app changelog (personal + team)

**Date:** 2026-05-06
**Status:** Draft — pending user review
**Author:** Claude (sonnet) with @cowcow02

## Problem

Fleetlens releases regularly (CLI on `v*` tags, team-server on `server-v*` tags) but users have no in-app way to find out what changed. They have to leave the app, find the GitHub release, and read auto-generated PR-list notes that are noisy with version-bump churn.

We want a quiet, low-friction surface that:

- Tells a user there's something new since they last looked.
- Doesn't block the UI (no modal, no banner, no popover).
- Stays local — no outbound calls to GitHub from the privacy-first CLI dashboard.
- Works offline.

## Decisions

### Source of truth: hand-curated `CHANGELOG.md`, two files

| File | Documents | Gated by |
|---|---|---|
| `CHANGELOG.md` (repo root) | Personal edition (`fleetlens` npm package) | `.github/workflows/release.yml` |
| `packages/team-server/CHANGELOG.md` | Team edition (`fleetlens-team-server` Docker image) | `.github/workflows/publish-team-server-image.yml` |

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each release gets a `## [X.Y.Z] — YYYY-MM-DD` heading with optional `### Added / ### Changed / ### Fixed` subsections.

**Why two files, not one:** the two version tracks already operate independently — separate workflows, separate `package.json` files, separate distributions. Two files mean each release workflow can run a single regex check ("does the new tag have a heading?") with no cross-section logic, and a user clicking through to GitHub lands on a file that's only about their edition.

**Why hand-curated, not auto-generated:** GitHub's auto-generated release notes leak version-bump churn ("chore: bump to v0.5.5 — button target for self-update demo"). A curated file under our control gives a clean user-facing log and lets us collapse multi-PR work into a single coherent entry.

### Surface: sidebar icon + red-dot-when-unread

Both apps already render a sidebar with a version badge at the bottom. We add a small **changelog icon** next to (or as a clickable wrapper around) the version. When there's an unread entry, a red dot sits on the corner of the icon. Clicking the icon navigates to `/changelog` and marks everything as read.

No banner. No modal. No toast. The dot is enough — surfacing the existence of news without interrupting whatever the user is doing.

### Read-state storage: localStorage, latest-version pointer

`localStorage["cclens:changelog-last-seen"] = "0.6.4"`

- On render, the sidebar compares the latest changelog entry's version against the stored last-seen value. If unstored or stale → red dot.
- On `/changelog` load, we write the current latest version to localStorage.
- Team-server uses the same pattern under `localStorage["cclens-team:changelog-last-seen"]`. Per-browser, not per-user — keeps it dead simple, and "I read this on my laptop, marked unread on my phone" is acceptable.

### Build-time embedding

Each app imports its own changelog file at build time and parses it into a structured array `[{ version, date, sections: [...] }, ...]`. No runtime fetch.

- **Personal (apps/web):** import the root `CHANGELOG.md` via a Webpack/Turbopack raw loader or `fs.readFileSync` in a server component.
- **Team (packages/team-server/src):** import the colocated `packages/team-server/CHANGELOG.md` the same way.

Parsing logic lives in a small shared util (~30 lines) — regex over markdown headings, no external library.

## Architecture

```
CHANGELOG.md (root) ─┐
                     ├─► parseChangelog() ─► /changelog page (CLI)
apps/web ────────────┘                       sidebar dot + icon (CLI)

packages/team-server/CHANGELOG.md ─┐
                                   ├─► parseChangelog() ─► /changelog page (team)
packages/team-server/src ──────────┘                       sidebar dot + icon (team)
```

The `parseChangelog()` util is duplicated rather than shared — it's small (~30 lines), and a shared package would mean adding a new workspace dep with no other consumer. If a third edition appears, promote it then.

## Components

### `apps/web/lib/changelog.ts` (CLI)
- `loadChangelog(): ChangelogEntry[]` — reads `CHANGELOG.md` at build time via `import` + raw-loader, returns parsed entries newest-first.
- `latestVersion(entries): string` — first entry's version, used for the unread comparison.

### `apps/web/components/changelog-icon.tsx`
- Client component, renders the icon + red dot.
- Reads `latestVersion` (passed in as prop from server) and compares against `localStorage["cclens:changelog-last-seen"]`.
- Initial render shows no dot to avoid hydration mismatch; effect runs on mount and re-renders.

### `apps/web/app/changelog/page.tsx`
- Server component renders parsed entries.
- A small client island writes `localStorage["cclens:changelog-last-seen"]` on mount.

### Team edition equivalents
- `packages/team-server/src/lib/changelog.ts`
- `packages/team-server/src/components/changelog-icon.tsx`
- `packages/team-server/src/app/changelog/page.tsx`

Both editions reuse the same `parseChangelog()` text → entries function, copy-pasted (not shared via a workspace package — see "Architecture").

## Release workflow gate

Add a step early in each release workflow:

```bash
TAG="${GITHUB_REF#refs/tags/}"
VERSION="${TAG#v}"          # also strips server-v
grep -q "## \[${VERSION}\]" "${CHANGELOG_PATH}" \
  || (echo "::error::No CHANGELOG entry for ${VERSION}"; exit 1)
```

Personal release uses `CHANGELOG.md`, team release uses `packages/team-server/CHANGELOG.md`. Failure aborts the publish — the human bumps the file, retags, retries.

## Edge cases & failure modes

- **CHANGELOG.md missing or empty.** Build-time import succeeds with `[]`, sidebar renders icon with no dot, `/changelog` shows "No releases yet."
- **Hydration mismatch.** Sidebar dot is client-only — server renders icon with no dot, client `useEffect` decides whether to show it. Single render-after-mount, no flicker because the dot is small and uncritical.
- **Old localStorage value.** If user updates from a version where this feature didn't exist, no `cclens:changelog-last-seen` key exists → all entries unread → dot shows. Acceptable: their first opening of `/changelog` clears it.
- **Pre-1.0 versions.** Keep-a-Changelog format handles arbitrary versions; we sort entries by their order in the file (newest at top per convention), not by parsing semver. Author discipline keeps them ordered.
- **Multiple entries between visits.** Single dot regardless of count — we're surfacing "there's something new," not "there are 3 things new."

## Out of scope

Explicitly dropped per discussion:

- Post-update banner / toast.
- Per-user read state synced across devices (DB-backed for team).
- Wiring `update-review-view.tsx` (the team self-update screen) to read from the curated CHANGELOG. This stays as-is; if we want to do it later it's a small follow-up.
- Auto-generation of CHANGELOG entries from PR titles. Curate by hand.
- Filtering / search on `/changelog`. Just chronological list.

## Testing

- **`parseChangelog()` unit tests:** parse a known markdown fixture into the expected entry array; tolerate missing date, missing subsections, multiple entries, blank input.
- **Sidebar-icon component test:** asserts dot renders when localStorage absent / older / equal / newer than current latest.
- **`/changelog` route smoke:** added to `scripts/smoke.mjs` for both editions.
- **Release-workflow gate:** unit-style test of the grep predicate against a fake CHANGELOG missing/containing the version heading.

No e2e tests — the flow is too thin to justify Playwright.

## Migration / rollout

- New `CHANGELOG.md` is created in this PR with the existing release history backfilled (curated, not pasted). Rough cap: last 10 personal releases, last 10 team releases. Anything older just isn't shown — fine, the feature is forward-looking.
- First release after merge is the first one whose entry is enforced by the workflow gate.
