---
name: wrap-up-and-release
description: Use when shipping a fleetlens CLI release — squash-merging the PR, writing the CHANGELOG entry, bumping the version, pushing the tag, and verifying the npm + GitHub Release land. Covers the CLI track only; team-server (server-v*) has its own path in CLAUDE.md.
---

# Wrap up and release the fleetlens CLI

## When to use

A feature PR is approved, CI is green, and the user wants it shipped. This is the post-merge → npm path. The CLI publishes via a tag-triggered workflow.

**Not for:** team-server releases (`server-v*` track — see CLAUDE.md), mid-flight fixes on an unmerged branch, or batched multi-PR releases (merge them all first, run this once).

## Steps

### 1. Verify the PR is shippable, then squash-merge

```bash
gh pr view <N> --json mergeable,mergeStateStatus,statusCheckRollup
```

Expect `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, and every check `SUCCESS` (or intentionally `SKIPPED`). Then:

```bash
gh pr merge <N> --squash --delete-branch
```

If you're running from a feature worktree, `gh` will error trying to `git checkout master` locally — that's a benign post-merge step the CLI does, NOT the merge itself. Confirm the remote merge succeeded:

```bash
gh pr view <N> --json state,mergedAt   # expect state: MERGED
```

Do not "fix" the checkout error by force-switching branches in unrelated worktrees.

### 2. Pull master into the primary worktree

The primary worktree is whichever local clone tracks `master`. Identify it with `git worktree list`. From any other location:

```bash
cd <primary-worktree> && git pull --ff-only origin master
```

### 3. Write the CHANGELOG entry

Add a new section at the top of `CHANGELOG.md` under the existing header:

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added / Changed / Fixed
- ...
```

Use Keep-a-Changelog section names. Reference the merged PR's user-visible changes — not every commit. Keep entries tight: one bullet per coherent change.

Commit as a standalone docs commit (no version bump yet):

```bash
git commit -m "docs(changelog): add X.Y.Z entry"
```

The CHANGELOG commit MUST land before the version-bump commit — the release workflow asserts the tag's entry exists.

### 4. Local safety pass

CI already validated the merge commit, but a quick final pass is worth the 10 seconds:

```bash
pnpm -F fleetlens test && pnpm -F fleetlens typecheck
```

### 5. Bump the version

Run `npm version` from the **repo root**. This triggers `scripts/version-sync.mjs`, propagating the new version to `packages/{cli,parser,entries}/package.json` and `apps/web/package.json`, then creates one commit `X.Y.Z` and one tag `vX.Y.Z`:

```bash
npm version patch   # bug fixes
npm version minor   # new features
npm version major   # breaking (held until 1.0)
```

Never edit `version` fields in sub-package `package.json` manually. Never run `npm version` from a sub-package directory — version-sync.mjs won't fire and the tag will be wrong.

### 6. Push master and tag

```bash
git push origin master
git push origin v<X.Y.Z>
```

Pushing the `v*` tag triggers `.github/workflows/release.yml` (tests → typecheck → build → `npm publish` via `NPM_TOKEN` → auto-generated GitHub Release).

### 7. Watch the release workflow, then confirm

```bash
gh run list --workflow=release.yml --limit 1
gh run watch <run-id> --exit-status
npm view fleetlens version           # should show X.Y.Z
gh release view v<X.Y.Z>             # GH Release with auto-generated notes
```

If the workflow fails, fix forward with a new patch — never delete and re-push the same tag (npm rejects re-publishing the same version).

## Common mistakes

| Mistake | Fix |
|---|---|
| `npm version` from a sub-package | Run from repo root only — version-sync.mjs won't fire otherwise. |
| Version-bump commit before CHANGELOG commit | The workflow asserts the entry exists for the tag. Add CHANGELOG first. |
| Re-pushing the same tag after a failed workflow | Fix forward to the next patch — npm rejects re-publishing the same version. |
| Confusing `v*` (CLI) with `server-v*` (team-server) | Different track, different command. See CLAUDE.md "Release process". |
| Treating the `gh pr merge` worktree-checkout error as fatal | The remote merge succeeded; verify with `gh pr view <N> --json state`. |

For version-bump rules (patch / minor / major) see CLAUDE.md.
