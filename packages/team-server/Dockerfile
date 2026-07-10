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

# Stage complete playwright packages (Next standalone NFT omits non-JS assets
# like browsers.json, which makes require("playwright") fail at runtime).
# Resolve from the team-server package dir — pnpm may not hoist to /app/node_modules.
RUN node -e "\
  const fs = require('fs'); \
  const path = require('path'); \
  const roots = [path.join(process.cwd(), 'packages/team-server'), process.cwd()]; \
  const core = path.dirname(require.resolve('playwright-core/package.json', { paths: roots })); \
  const pw = path.dirname(require.resolve('playwright/package.json', { paths: roots })); \
  fs.cpSync(core, '/tmp/playwright-core-full', { recursive: true }); \
  fs.cpSync(pw, '/tmp/playwright-full', { recursive: true }); \
  console.log('staged', core, pw); \
"

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

# Overlay complete playwright packages on top of the incomplete NFT copies.
# Production has failed with both flat node_modules and pnpm-virtual-store
# resolution paths, so plant both.
COPY --from=builder /tmp/playwright-core-full /opt/playwright-core
COPY --from=builder /tmp/playwright-full /opt/playwright
RUN set -eux; \
  mkdir -p node_modules; \
  rm -rf node_modules/playwright-core node_modules/playwright; \
  cp -a /opt/playwright-core node_modules/playwright-core; \
  cp -a /opt/playwright node_modules/playwright; \
  # pnpm nest (path seen in Cloud Run: node_modules/.pnpm/playwright-core@1.60.0/...)
  mkdir -p \
    node_modules/.pnpm/playwright-core@1.60.0/node_modules \
    node_modules/.pnpm/playwright@1.60.0/node_modules; \
  rm -rf \
    node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core \
    node_modules/.pnpm/playwright@1.60.0/node_modules/playwright; \
  cp -a /opt/playwright-core node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core; \
  cp -a /opt/playwright node_modules/.pnpm/playwright@1.60.0/node_modules/playwright; \
  ln -sfn ../../playwright-core@1.60.0/node_modules/playwright-core \
    node_modules/.pnpm/playwright@1.60.0/node_modules/playwright-core; \
  # Sanity: package must load without browsers.json missing
  node -e "require('playwright'); require('fs').accessSync(require('path').join(require('path').dirname(require.resolve('playwright-core/package.json')), 'browsers.json')); console.log('playwright ok')"; \
  rm -rf /opt/playwright-core /opt/playwright

ENV PORT=3322
ENV HOSTNAME=0.0.0.0
EXPOSE 3322

CMD ["node", "packages/team-server/server.js"]
