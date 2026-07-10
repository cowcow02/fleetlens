FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable pnpm

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY tsconfig.base.json ./

# Copy packages needed for build
COPY packages/parser/ packages/parser/
COPY packages/team-server/ packages/team-server/

RUN pnpm install --frozen-lockfile
RUN pnpm -F @claude-lens/team-server build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ARG APP_VERSION=0.0.0-dev
ENV APP_VERSION=$APP_VERSION

# Playwright browsers live outside the app tree so the standalone bundle
# doesn't have to embed ~150MB of Chromium. Must match the playwright
# version pinned in packages/team-server/package.json.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npx --yes playwright@1.60.0 install --with-deps chromium

# Copy standalone output (TS schema is bundled via src/db/schema.ts).
COPY --from=builder /app/packages/team-server/.next/standalone ./
COPY --from=builder /app/packages/team-server/.next/static ./packages/team-server/.next/static
# Drizzle's SQL migration files aren't traced by Next's standalone bundler
# (the migrationsFolder path is resolved at runtime, not statically imported).
# Copy them into the image at the same project-relative path runMigrations()
# resolves via process.cwd().
COPY --from=builder /app/packages/team-server/src/db/migrations \
     ./packages/team-server/src/db/migrations

ENV PORT=3322
ENV HOSTNAME=0.0.0.0
EXPOSE 3322

CMD ["node", "packages/team-server/server.js"]
