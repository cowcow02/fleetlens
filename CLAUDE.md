# Claude Lens

Local-only, privacy-first dashboard for Claude Code sessions. Reads JSONL transcripts from `~/.claude/projects/` and visualizes agent activity.

## Architecture

pnpm monorepo with Turborepo:

- `packages/parser` — `@claude-lens/parser`: JSONL parsing, analytics, filesystem scanning. Pure TypeScript, no framework deps.
- `packages/cli` — `cclens` (published to npm): CLI that manages the dashboard server, provides terminal stats, handles auto-updates.
- `apps/web` — `@claude-lens/web`: Next.js dashboard (standalone output bundled into the CLI package).

## Dev Commands

```bash
pnpm dev          # Start all packages in dev/watch mode
pnpm build        # Build all packages (parser → web → cli)
pnpm test         # Run vitest across all packages
pnpm typecheck    # TypeScript check across all packages
pnpm verify       # typecheck + smoke tests
pnpm clean        # Remove all build artifacts
```

## CLI Dev

```bash
pnpm -F cclens build    # Build CLI with esbuild
pnpm -F cclens test     # Run CLI tests
node packages/cli/dist/index.js stats   # Test stats locally
```

## Versioning

All packages share a single version. The root `package.json` is the source of truth.

**Never edit version numbers in sub-package `package.json` files manually.**

The `npm version` command at the monorepo root bumps the version and syncs it to all packages via the `version` lifecycle hook (`scripts/version-sync.mjs`).

## Release Process

**When to release:** After completing a user-facing change (feature, fix, improvement) on `master`.

**Version bump rules:**
- `patch`: bug fixes, small tweaks
- `minor`: new features, new commands, notable improvements
- `major`: breaking changes (not until v1)

**Commands:**
```bash
pnpm test && pnpm verify     # Must pass before release
npm version patch             # or minor/major — bumps all packages, commits, tags
git push --follow-tags        # Triggers CI → npm publish → GitHub Release
```

The agent does not need npm credentials. Pushing the tag triggers GitHub Actions which publishes to npm using a stored `NPM_TOKEN` secret.

## Port

Default: 3321. Override with `--port` flag or `CCLENS_PORT` env var.
