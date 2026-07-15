#!/usr/bin/env node
/**
 * Generate a deterministic, entirely fictional Claude Code workspace for
 * Fleetlens documentation screenshots.
 *
 * Usage:
 *   node scripts/generate-demo-transcripts.mjs --home <dir> [--days N]
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const VERSION = "2.1.100";
const DEFAULT_DAYS = 21;
const MODELS = [
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
];

const PROJECTS = [
  {
    name: "orbit-shop",
    cwd: "/Users/demo/Repo/orbit-shop",
    tasks: [
      {
        prompt: "Implement the checkout coupon flow, including validation, totals, and focused tests.",
        title: "Implement checkout coupon flow",
        file: "src/checkout/apply-coupon.ts",
        testFile: "src/checkout/apply-coupon.test.ts",
        search: "applyCoupon",
        oldCode: "return { ...cart, discount: 0 };",
        newCode: "const discount = validateCoupon(cart, coupon);\nreturn recalculateTotals(cart, discount);",
        test: "pnpm test src/checkout/apply-coupon.test.ts",
      },
      {
        prompt: "Fix the flaky payment webhook test without weakening its assertions.",
        title: "Stabilize payment webhook test",
        file: "src/payments/webhook-handler.ts",
        testFile: "src/payments/webhook-handler.test.ts",
        search: "payment.succeeded",
        oldCode: "await waitFor(() => expect(events).toHaveLength(1));",
        newCode: "await drainWebhookQueue();\nexpect(events).toEqual([expectedPaymentEvent]);",
        test: "pnpm test src/payments/webhook-handler.test.ts --runInBand",
      },
      {
        prompt: "Add cart reservation expiry and make stale reservations safe to retry.",
        title: "Add cart reservation expiry",
        file: "src/cart/reservations.ts",
        testFile: "src/cart/reservations.test.ts",
        search: "reservationExpiresAt",
        oldCode: "return reservation.status === \"active\";",
        newCode: "return reservation.status === \"active\" && reservation.expiresAt > clock.now();",
        test: "pnpm test src/cart/reservations.test.ts",
      },
      {
        prompt: "Validate gift-card balances atomically during checkout and cover partial redemption.",
        title: "Validate gift card redemption",
        file: "src/checkout/gift-cards.ts",
        testFile: "src/checkout/gift-cards.test.ts",
        search: "redeemGiftCard",
        oldCode: "const applied = Math.min(balance, total);",
        newCode: "const applied = await reserveGiftCardBalance(cardId, total, transaction);",
        test: "pnpm test src/checkout/gift-cards.test.ts",
      },
      {
        prompt: "Optimize product-search facets while preserving stable result ordering.",
        title: "Optimize product search facets",
        file: "src/search/product-facets.ts",
        testFile: "src/search/product-facets.test.ts",
        search: "buildFacetCounts",
        oldCode: "return products.map(buildFacets).flat();",
        newCode: "return aggregateFacets(products, { stableOrder: true });",
        test: "pnpm test src/search/product-facets.test.ts",
      },
      {
        prompt: "Add order-confirmation analytics with idempotent event emission.",
        title: "Add order confirmation analytics",
        file: "src/orders/confirmation-events.ts",
        testFile: "src/orders/confirmation-events.test.ts",
        search: "order.confirmed",
        oldCode: "analytics.track(\"order.confirmed\", payload);",
        newCode: "await analytics.trackOnce(order.id, \"order.confirmed\", payload);",
        test: "pnpm test src/orders/confirmation-events.test.ts",
      },
    ],
  },
  {
    name: "fleet-dashboard",
    cwd: "/Users/demo/Repo/fleet-dashboard",
    tasks: [
      {
        prompt: "Add labels to the concurrency heatmap and keep dense days readable.",
        title: "Label concurrency heatmap",
        file: "src/components/concurrency-heatmap.tsx",
        testFile: "src/components/concurrency-heatmap.test.tsx",
        search: "ConcurrencyCell",
        oldCode: "<Cell intensity={point.value} />",
        newCode: "<Cell intensity={point.value} aria-label={formatConcurrency(point)} />",
        test: "pnpm test src/components/concurrency-heatmap.test.tsx",
      },
      {
        prompt: "Fix session-filter persistence when navigating between dashboard views.",
        title: "Persist session filters",
        file: "src/state/session-filters.ts",
        testFile: "src/state/session-filters.test.ts",
        search: "restoreFilters",
        oldCode: "return defaults;",
        newCode: "return filterSchema.parse(storage.read(FILTER_KEY) ?? defaults);",
        test: "pnpm test src/state/session-filters.test.ts",
      },
      {
        prompt: "Surface the worktree rollup badge on project cards and add regression coverage.",
        title: "Show worktree rollup badge",
        file: "src/components/project-card.tsx",
        testFile: "src/components/project-card.test.tsx",
        search: "worktreeCount",
        oldCode: "<ProjectTitle name={project.name} />",
        newCode: "<ProjectTitle name={project.name} badge={worktreeLabel(project.worktreeCount)} />",
        test: "pnpm test src/components/project-card.test.tsx",
      },
      {
        prompt: "Improve the idle-segment tooltip so wall time and agent time are clearly distinguished.",
        title: "Clarify idle segment tooltip",
        file: "src/components/idle-segment-tooltip.tsx",
        testFile: "src/components/idle-segment-tooltip.test.tsx",
        search: "agentTimeMs",
        oldCode: "return formatDuration(durationMs);",
        newCode: "return `${formatDuration(agentTimeMs)} agent time · ${formatDuration(durationMs)} wall`;",
        test: "pnpm test src/components/idle-segment-tooltip.test.tsx",
      },
      {
        prompt: "Add a per-model cost breakdown to the weekly usage summary.",
        title: "Add model cost breakdown",
        file: "src/analytics/model-costs.ts",
        testFile: "src/analytics/model-costs.test.ts",
        search: "estimateModelCost",
        oldCode: "return sessions.reduce(sumCost, 0);",
        newCode: "return groupByModel(sessions).map(summarizeModelCost);",
        test: "pnpm test src/analytics/model-costs.test.ts",
      },
      {
        prompt: "Repair weekly activity bucketing around timezone boundaries.",
        title: "Fix weekly activity timezone buckets",
        file: "src/analytics/weekly-activity.ts",
        testFile: "src/analytics/weekly-activity.test.ts",
        search: "localDayKey",
        oldCode: "const day = timestamp.slice(0, 10);",
        newCode: "const day = localDayKey(Date.parse(timestamp), timeZone);",
        test: "pnpm test src/analytics/weekly-activity.test.ts",
      },
    ],
  },
  {
    name: "docs-site",
    cwd: "/Users/demo/Repo/docs-site",
    tasks: [
      {
        prompt: "Document SDK pagination with runnable cursor examples and edge cases.",
        title: "Document SDK pagination",
        file: "content/sdk/pagination.mdx",
        testFile: "tests/content/pagination.test.ts",
        search: "nextCursor",
        oldCode: "## Pagination\n\nResults may be paginated.",
        newCode: "## Cursor pagination\n\nPass `nextCursor` into the following request until it is null.",
        test: "pnpm test tests/content/pagination.test.ts",
      },
      {
        prompt: "Fix broken API reference anchors and add a link-integrity regression test.",
        title: "Fix API reference anchors",
        file: "src/markdown/heading-ids.ts",
        testFile: "tests/links/api-reference.test.ts",
        search: "slugHeading",
        oldCode: "return heading.toLowerCase().replaceAll(\" \", \"-\");",
        newCode: "return referenceSlugger.slug(heading);",
        test: "pnpm test tests/links/api-reference.test.ts",
      },
      {
        prompt: "Add a migration guide for the fictional v3 client configuration format.",
        title: "Add v3 client migration guide",
        file: "content/guides/migrate-v3.mdx",
        testFile: "tests/content/migrate-v3.test.ts",
        search: "clientOptions",
        oldCode: "export const metadata = { title: \"Migration\" };",
        newCode: "export const metadata = { title: \"Migrate to client v3\", reviewed: true };",
        test: "pnpm test tests/content/migrate-v3.test.ts",
      },
      {
        prompt: "Build a component preview for request and response examples in the docs.",
        title: "Add request response preview",
        file: "src/components/request-response-preview.tsx",
        testFile: "src/components/request-response-preview.test.tsx",
        search: "CodeExample",
        oldCode: "return <pre>{example}</pre>;",
        newCode: "return <TabbedCodeExample request={request} response={response} />;",
        test: "pnpm test src/components/request-response-preview.test.tsx",
      },
      {
        prompt: "Improve documentation search metadata for guides and API pages.",
        title: "Improve docs search metadata",
        file: "src/search/build-index.ts",
        testFile: "src/search/build-index.test.ts",
        search: "searchMetadata",
        oldCode: "return { title: page.title, body: page.text };",
        newCode: "return { title: page.title, body: page.text, section: page.section, aliases: page.aliases };",
        test: "pnpm test src/search/build-index.test.ts",
      },
      {
        prompt: "Add copy-button feedback to code samples without shifting the page layout.",
        title: "Improve code sample copy feedback",
        file: "src/components/code-sample.tsx",
        testFile: "src/components/code-sample.test.tsx",
        search: "copyToClipboard",
        oldCode: "setCopied(true);",
        newCode: "announceCopySuccess();\nsetCopied(true);",
        test: "pnpm test src/components/code-sample.test.tsx",
      },
    ],
  },
  {
    name: "infra-tools",
    cwd: "/Users/demo/Repo/infra-tools",
    tasks: [
      {
        prompt: "Add ENG-142 rate limiting to the deploy API with per-environment budgets.",
        title: "Add ENG-142 deploy rate limiting",
        file: "src/api/deploy-rate-limit.ts",
        testFile: "src/api/deploy-rate-limit.test.ts",
        search: "deployBudget",
        oldCode: "return deploy(request);",
        newCode: "await deployLimiter.consume(request.environment);\nreturn deploy(request);",
        test: "pnpm test src/api/deploy-rate-limit.test.ts",
      },
      {
        prompt: "Add a Terraform drift summary with stable resource grouping.",
        title: "Add Terraform drift summary",
        file: "src/terraform/drift-summary.ts",
        testFile: "src/terraform/drift-summary.test.ts",
        search: "resourceChanges",
        oldCode: "return plan.resource_changes.length;",
        newCode: "return groupChangesByModule(plan.resource_changes).map(summarizeModule);",
        test: "pnpm test src/terraform/drift-summary.test.ts",
      },
      {
        prompt: "Harden the deploy health check against slow but healthy startup probes.",
        title: "Harden deploy health check",
        file: "src/deploy/health-check.ts",
        testFile: "src/deploy/health-check.test.ts",
        search: "startupProbe",
        oldCode: "if (!response.ok) throw new Error(\"unhealthy\");",
        newCode: "return retryStartupProbe(response, { attempts: 4, backoffMs: 750 });",
        test: "pnpm test src/deploy/health-check.test.ts",
      },
      {
        prompt: "Parallelize container-image scanning while preserving deterministic reports.",
        title: "Parallelize container image scans",
        file: "src/security/image-scan.ts",
        testFile: "src/security/image-scan.test.ts",
        search: "scanLayer",
        oldCode: "for (const layer of layers) results.push(await scanLayer(layer));",
        newCode: "const results = await mapWithConcurrency(layers, 4, scanLayer);",
        test: "pnpm test src/security/image-scan.test.ts",
      },
      {
        prompt: "Add a rollback dry-run that previews affected services and dependencies.",
        title: "Add rollback dry run",
        file: "src/deploy/rollback.ts",
        testFile: "src/deploy/rollback.test.ts",
        search: "rollbackRelease",
        oldCode: "return rollbackRelease(releaseId);",
        newCode: "return options.dryRun ? previewRollback(releaseId) : rollbackRelease(releaseId);",
        test: "pnpm test src/deploy/rollback.test.ts",
      },
      {
        prompt: "Make staging cache-key rotation observable and safe to resume.",
        title: "Make cache key rotation resumable",
        file: "src/cache/rotate-keys.ts",
        testFile: "src/cache/rotate-keys.test.ts",
        search: "rotationCheckpoint",
        oldCode: "await rotateAllKeys(environment);",
        newCode: "await rotateKeysFromCheckpoint(environment, await loadCheckpoint(environment));",
        test: "pnpm test src/cache/rotate-keys.test.ts",
      },
    ],
  },
];

function usage() {
  return "Usage: node scripts/generate-demo-transcripts.mjs --home <dir> [--days N=21] [--perception]";
}

function parseArgs(argv) {
  let home;
  let days = DEFAULT_DAYS;
  let perception = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--home") {
      home = argv[++i];
      continue;
    }
    if (arg.startsWith("--home=")) {
      home = arg.slice("--home=".length);
      continue;
    }
    if (arg === "--days") {
      days = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith("--days=")) {
      days = Number(arg.slice("--days=".length));
      continue;
    }
    if (arg === "--perception") {
      perception = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!home) throw new Error("--home is required");
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("--days must be a positive integer");
  }
  return { home: path.resolve(home), days, perception };
}

function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(value) {
  const hex = hashHex(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function createRng(seedText) {
  let state = Number.parseInt(hashHex(seedText).slice(0, 8), 16) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function encodeProjectDir(cwd) {
  return cwd.replace(/[/.]/g, "-");
}

function localDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalMinutes(day, minutes) {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
  );
}

function scheduleSessions(days, endDay, rng) {
  const sessions = [];
  const weekdaySlots = [9 * 60, 9 * 60 + 9, 10 * 60 + 35, 13 * 60 + 10, 13 * 60 + 22, 15 * 60 + 20, 15 * 60 + 31, 17 * 60];
  const weekendSlots = [10 * 60, 10 * 60 + 11, 14 * 60 + 10, 14 * 60 + 22];
  const startDay = new Date(endDay.getTime() - (days - 1) * DAY_MS);

  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const day = new Date(startDay.getTime() + dayIndex * DAY_MS);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const sessionCount = weekend ? randomInt(rng, 3, 4) : randomInt(rng, 5, 8);
    const slots = weekend ? weekendSlots : weekdaySlots;
    const pairProject = dayIndex % PROJECTS.length;
    const sameProjectPair = dayIndex % 3 === 0;

    for (let daySlot = 0; daySlot < sessionCount; daySlot++) {
      let projectIndex;
      if (daySlot === 0) projectIndex = pairProject;
      else if (daySlot === 1) {
        projectIndex = sameProjectPair ? pairProject : (pairProject + 1) % PROJECTS.length;
      } else {
        projectIndex = randomInt(rng, 0, PROJECTS.length - 1);
      }

      const paired = daySlot < 2 || daySlot === 4 || daySlot === 6;
      const durationMinutes = paired
        ? randomInt(rng, 48, 86)
        : randomInt(rng, 10, 78);
      const startJitter = daySlot < 2 ? randomInt(rng, 0, 4) : randomInt(rng, -5, 6);
      const start = addLocalMinutes(day, slots[daySlot] + startJitter);
      sessions.push({
        dayIndex,
        daySlot,
        projectIndex,
        cwd: PROJECTS[projectIndex].cwd,
        start,
        durationMinutes,
      });
    }
  }

  const worktreeCandidate = sessions.find(
    (session) =>
      session.projectIndex === 0 &&
      session.daySlot >= 2 &&
      session.dayIndex >= Math.floor(days / 3),
  ) ?? sessions.find((session) => session.projectIndex === 0 && session.daySlot >= 2);
  if (worktreeCandidate) {
    worktreeCandidate.cwd = "/Users/demo/Repo/orbit-shop/.worktrees/checkout-flow";
    worktreeCandidate.isWorktree = true;
  }

  return { sessions, startDay };
}

function allocateBounded(total, count, min, max, rng) {
  const values = [];
  let remaining = total;
  for (let i = 0; i < count; i++) {
    const slotsLeft = count - i - 1;
    const low = Math.max(min, remaining - slotsLeft * max);
    const high = Math.min(max, remaining - slotsLeft * min);
    const value = i === count - 1 ? remaining : randomInt(rng, low, high);
    values.push(value);
    remaining -= value;
  }
  return values;
}

function eventGaps(durationMinutes, eventCount, rng) {
  const durationSeconds = durationMinutes * 60;
  const intervalCount = eventCount - 1;
  const idleCount = durationMinutes >= 50 ? 3 : durationMinutes >= 35 ? 2 : durationMinutes >= 25 ? 1 : 0;
  const idleGaps = Array.from({ length: idleCount }, () => randomInt(rng, 245, 420));
  const activeCount = intervalCount - idleCount;
  const activeTotal = durationSeconds - idleGaps.reduce((sum, gap) => sum + gap, 0);
  if (activeTotal < activeCount * 5 || activeTotal > activeCount * 180) {
    throw new Error(`Cannot distribute ${durationMinutes} minutes across ${eventCount} events`);
  }
  const activeGaps = allocateBounded(activeTotal, activeCount, 5, 180, rng);
  const idlePositions = new Set(
    idleGaps.map((_, index) => Math.floor(((index + 1) * intervalCount) / (idleCount + 1))),
  );
  const gaps = [];
  let activeIndex = 0;
  let idleIndex = 0;
  for (let i = 0; i < intervalCount; i++) {
    if (idlePositions.has(i)) gaps.push(idleGaps[idleIndex++]);
    else gaps.push(activeGaps[activeIndex++]);
  }
  return gaps;
}

function branchFor(task, sessionIndex) {
  const prefix = task.title.startsWith("Fix") || task.title.startsWith("Stabilize")
    ? "fix"
    : sessionIndex % 5 === 0
      ? "chore"
      : "feature";
  return `${prefix}/${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function makeActions(task, cwd, shipping, actionCount) {
  const absoluteFile = path.posix.join(cwd, task.file);
  const absoluteTest = path.posix.join(cwd, task.testFile);
  const core = [
    {
      name: "Read",
      input: { file_path: absoluteFile },
      result: `export async function ${task.search}(input) {\n  ${task.oldCode}\n}\n`,
      intent: "I’ll start from the implementation boundary and trace its current assumptions.",
      after: "The behavior is localized, but its caller expects the result to remain stable.",
    },
    {
      name: "Grep",
      input: { pattern: task.search, path: cwd, output_mode: "content" },
      result: `${task.file}:14:export async function ${task.search}(input) {\n${task.testFile}:27:describe(\"${task.search}\", () => {`,
      intent: "I’m finding callers and tests before changing the contract.",
      after: "There is one production caller and a focused test suite, so the change can stay narrow.",
    },
    {
      name: "Read",
      input: { file_path: absoluteTest, offset: 1, limit: 220 },
      result: `describe(\"${task.search}\", () => {\n  it(\"handles the existing path\", async () => {\n    expect(await subject()).toMatchObject(expected);\n  });\n});\n`,
      intent: "I’ll preserve the existing scenario and add coverage beside it.",
      after: "The fixture already exposes the right seam for a regression case.",
    },
    {
      name: "Edit",
      input: { file_path: absoluteFile, old_string: task.oldCode, new_string: task.newCode },
      result: `Updated ${task.file}.`,
      intent: "I’m applying the smallest production change that satisfies the new case.",
      after: "The implementation now handles the requested path without widening the public API.",
    },
    {
      name: "Bash",
      input: { command: task.test, description: "Run focused tests" },
      result: `PASS ${task.testFile}\nTests: 6 passed, 6 total\nTime: 1.84 s`,
      intent: "I’ll run the focused suite before expanding coverage.",
      after: "The focused suite is green; I’ll add the missing edge assertion next.",
    },
    {
      name: "Edit",
      input: {
        file_path: absoluteTest,
        old_string: "expect(await subject()).toMatchObject(expected);",
        new_string: "const result = await subject();\nexpect(result).toMatchObject(expected);\nexpect(result).toSatisfyInvariant();",
      },
      result: `Updated ${task.testFile}.`,
      intent: "I’m making the regression explicit rather than relying on the broad snapshot.",
      after: "The new assertion captures both the result and the invariant that previously regressed.",
    },
    {
      name: "Grep",
      input: { pattern: "TODO|FIXME|skip\\(|only\\(", path: path.posix.dirname(absoluteTest), output_mode: "content" },
      result: "No matches found",
      intent: "I’ll check that the nearby suite has no skipped cases or temporary bypasses.",
      after: "No skipped tests or temporary markers are hiding failures in this area.",
    },
    {
      name: "Bash",
      input: { command: task.test, description: "Re-run focused tests" },
      result: `PASS ${task.testFile}\nTests: 7 passed, 7 total\nTime: 1.96 s`,
      intent: "I’m rerunning the focused suite with the new regression case.",
      after: "All seven focused cases pass with the new behavior covered.",
    },
    {
      name: "Bash",
      input: { command: "git diff --check && git status --short", description: "Inspect working tree" },
      result: ` M ${task.file}\n M ${task.testFile}`,
      intent: "I’ll check the diff for whitespace errors and confirm the touched surface.",
      after: "The diff is clean and limited to the implementation plus its focused test.",
    },
    {
      name: "Bash",
      input: { command: "pnpm typecheck", description: "Run typecheck" },
      result: "Tasks: 4 successful, 4 total\nTime: 3.21s",
      intent: "I’ll run the workspace typecheck before wrapping up.",
      after: "Typechecking passes across the workspace.",
    },
    {
      name: "Read",
      input: { file_path: absoluteFile, offset: 1, limit: 180 },
      result: `export async function ${task.search}(input) {\n  ${task.newCode}\n}\n`,
      intent: "I’m doing a final read of the changed path for naming and control-flow clarity.",
      after: "The final implementation is direct and the error path remains visible.",
    },
    {
      name: "Bash",
      input: { command: "pnpm test -- --changed", description: "Run changed tests" },
      result: "Test Files  4 passed (4)\nTests  29 passed (29)\nDuration  4.08s",
      intent: "I’ll run the related changed-file suite as a final regression check.",
      after: "Related tests are green, including the newly added case.",
    },
    {
      name: "Bash",
      input: { command: "git diff --stat", description: "Summarize changes" },
      result: `${task.file}      | 12 ++++++++----\n${task.testFile} | 18 ++++++++++++++++--\n2 files changed, 24 insertions(+), 6 deletions(-)`,
      intent: "I’ll summarize the final patch size.",
      after: "The patch stays compact: two files, with most additions in regression coverage.",
    },
  ];

  const shippingActions = [
    {
      name: "Bash",
      input: { command: `git commit -m \"${task.title}\"`, description: "Commit changes" },
      result: `[${branchFor(task, 0)} 7c4a2e1] ${task.title}\n 2 files changed, 24 insertions(+), 6 deletions(-)`,
      intent: "The verification is clean, so I’ll record the focused change.",
      after: "The implementation and regression test are committed together.",
    },
    {
      name: "Bash",
      input: { command: "git push -u origin HEAD", description: "Push branch" },
      result: "branch set up to track 'origin/demo-branch'.\nEverything up-to-date",
      intent: "I’ll push the fictional feature branch for review.",
      after: "The branch is available remotely and ready for a pull request.",
    },
    {
      name: "Bash",
      input: {
        command: `gh pr create --title \"${task.title}\" --body \"Adds focused implementation and regression coverage.\"`,
        description: "Create pull request",
      },
      result: "https://example.invalid/demo/repository/pull/142",
      intent: "I’ll open the pull request with the verified scope and test evidence.",
      after: "The fictional pull request is open with the test plan attached.",
    },
  ];

  if (!shipping) return core.slice(0, actionCount);
  return [...core.slice(0, Math.max(1, actionCount - shippingActions.length)), ...shippingActions];
}

function buildDescriptors(task, cwd, shipping, actionCount) {
  const descriptors = [
    { kind: "user", content: task.prompt },
    {
      kind: "assistant-text",
      content: "I’ll trace the current implementation and tests first, then make the smallest compatible change and verify it end to end.",
    },
  ];
  const actions = makeActions(task, cwd, shipping, actionCount);
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    descriptors.push({ kind: "tool", action });
    descriptors.push({ kind: "tool-result", action });
    descriptors.push({ kind: "assistant-text", content: action.after });
    if (i === 2) {
      descriptors.push({
        kind: "user",
        content: "Please keep the existing behavior backward compatible and include a targeted regression test.",
      });
    }
  }
  descriptors.push({
    kind: "assistant-text",
    content: shipping
      ? `Implemented and shipped “${task.title}”. Focused tests and typechecking pass, and the fictional pull request is ready for review.`
      : `Implemented “${task.title}” with focused regression coverage. The targeted checks pass and the change is ready for review.`,
  });
  return descriptors;
}

function assistantUsage(rng, model) {
  const modelScale = model.includes("haiku") ? 0.65 : model.includes("opus") ? 1.2 : 1;
  return {
    input_tokens: Math.round(randomInt(rng, 900, 4200) * modelScale),
    output_tokens: Math.round(randomInt(rng, 90, 520) * modelScale),
    cache_creation_input_tokens: randomInt(rng, 0, 1800),
    cache_read_input_tokens: randomInt(rng, 1200, 14000),
  };
}

function buildMainEvents({ descriptors, gaps, sessionKey, sessionId, cwd, branch, model, start, rng }) {
  const events = [];
  let timestampMs = start.getTime();
  let parentUuid = null;
  let toolUseId;

  for (let i = 0; i < descriptors.length; i++) {
    if (i > 0) timestampMs += gaps[i - 1] * 1000;
    const descriptor = descriptors[i];
    const uuid = deterministicUuid(`${sessionKey}:event:${i}`);
    const common = {
      parentUuid,
      isSidechain: false,
      uuid,
      timestamp: new Date(timestampMs).toISOString(),
      cwd,
      sessionId,
      version: VERSION,
      gitBranch: branch,
      entrypoint: "cli",
    };

    if (descriptor.kind === "user") {
      events.push({
        ...common,
        type: "user",
        message: { role: "user", content: descriptor.content },
      });
    } else if (descriptor.kind === "assistant-text") {
      const messageId = `msg_${hashHex(`${sessionKey}:message:${i}`).slice(0, 20)}`;
      events.push({
        ...common,
        type: "assistant",
        requestId: `req_${hashHex(`${sessionKey}:request:${i}`).slice(0, 18)}`,
        message: {
          model,
          id: messageId,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: descriptor.content }],
          stop_reason: "end_turn",
          usage: assistantUsage(rng, model),
        },
      });
    } else if (descriptor.kind === "tool") {
      toolUseId = `toolu_${hashHex(`${sessionKey}:tool:${i}`).slice(0, 20)}`;
      const messageId = `msg_${hashHex(`${sessionKey}:message:${i}`).slice(0, 20)}`;
      events.push({
        ...common,
        type: "assistant",
        requestId: `req_${hashHex(`${sessionKey}:request:${i}`).slice(0, 18)}`,
        message: {
          model,
          id: messageId,
          type: "message",
          role: "assistant",
          content: [
            { type: "tool_use", id: toolUseId, name: descriptor.action.name, input: descriptor.action.input },
            { type: "text", text: descriptor.action.intent },
          ],
          stop_reason: "tool_use",
          usage: assistantUsage(rng, model),
        },
      });
    } else {
      events.push({
        ...common,
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: descriptor.action.result,
              is_error: false,
            },
          ],
        },
      });
    }
    parentUuid = uuid;
  }
  return events;
}

function buildSidechain({ sessionKey, sessionId, cwd, branch, model, mainEvents, rng }) {
  const anchorIndex = Math.max(2, Math.floor(mainEvents.length * 0.45));
  const anchor = mainEvents[anchorIndex];
  const next = mainEvents[Math.min(mainEvents.length - 1, anchorIndex + 1)];
  const startMs = Date.parse(anchor.timestamp) + Math.max(5_000, Math.floor((Date.parse(next.timestamp) - Date.parse(anchor.timestamp)) / 3));
  const lines = [
    {
      type: "user",
      content: "Review the nearby implementation for hidden compatibility risks and report only actionable findings.",
    },
    {
      type: "tool",
      name: "Grep",
      input: { pattern: "deprecated|compat|fallback", path: cwd, output_mode: "content" },
      content: "src/shared/compatibility.ts:31:export function preserveLegacyFallback(input) {",
    },
    {
      type: "assistant",
      content: "The compatibility fallback is still called by the legacy adapter; the main change leaves that boundary intact.",
    },
  ];
  const events = [];
  let parentUuid = anchor.uuid;
  let toolUseId;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const uuid = deterministicUuid(`${sessionKey}:sidechain:${i}`);
    const common = {
      parentUuid,
      isSidechain: true,
      uuid,
      timestamp: new Date(startMs + i * randomInt(rng, 18, 52) * 1000).toISOString(),
      cwd,
      sessionId,
      version: VERSION,
      gitBranch: branch,
      entrypoint: "cli",
    };
    if (line.type === "user") {
      events.push({ ...common, type: "user", message: { role: "user", content: line.content } });
    } else if (line.type === "tool") {
      toolUseId = `toolu_${hashHex(`${sessionKey}:sidechain-tool`).slice(0, 20)}`;
      events.push({
        ...common,
        type: "assistant",
        requestId: `req_${hashHex(`${sessionKey}:sidechain-request`).slice(0, 18)}`,
        message: {
          model,
          id: `msg_${hashHex(`${sessionKey}:sidechain-message`).slice(0, 20)}`,
          type: "message",
          role: "assistant",
          content: [{ type: "tool_use", id: toolUseId, name: line.name, input: line.input }],
          stop_reason: "tool_use",
          usage: assistantUsage(rng, model),
        },
      });
    } else {
      events.push({
        ...common,
        type: "assistant",
        requestId: `req_${hashHex(`${sessionKey}:sidechain-final-request`).slice(0, 18)}`,
        message: {
          model,
          id: `msg_${hashHex(`${sessionKey}:sidechain-final-message`).slice(0, 20)}`,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: line.content }],
          stop_reason: "end_turn",
          usage: assistantUsage(rng, model),
        },
      });
    }
    parentUuid = uuid;
  }
  return events;
}

function selectSidechainIndexes(sessionCount) {
  return new Set([
    Math.floor(sessionCount * 0.2),
    Math.floor(sessionCount * 0.5),
    Math.floor(sessionCount * 0.8),
  ]);
}

const DEMO_NAMES = ["Erin", "Alice", "Bob", "Dana"];

function round1(value) {
  return Math.round(value * 10) / 10;
}

function dateFromLocalDay(day) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

function shiftLocalDay(day, offset) {
  return localDay(new Date(dateFromLocalDay(day).getTime() + offset * DAY_MS));
}

function isoAtLocalTime(day, hours, minutes) {
  const date = dateFromLocalDay(day);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function isoWeekMonday(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function weekDays(monday) {
  return Array.from({ length: 7 }, (_, index) => shiftLocalDay(monday, index));
}

function mondaysInMonth(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  first.setDate(first.getDate() + ((8 - first.getDay()) % 7));
  const mondays = [];
  while (first.getMonth() === month - 1) {
    mondays.push(localDay(first));
    first.setDate(first.getDate() + 7);
  }
  return mondays;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function displayProject(project) {
  return project.split("/").filter(Boolean).at(-1) ?? project;
}

function canonicalDemoProject(cwd) {
  return cwd.replace(/\/\.worktrees\/[^/]+(?:\/.*)?$/, "");
}

function ticketFor(index) {
  return `ORB-${240 + (index % 57)}`;
}

function sanitizePerceptionText(text, ticket) {
  return text
    .replace(/\b[A-Z]{2,}-\d+\b/g, ticket)
    .replace(/https?:\/\/\S+/g, "the fictional review link");
}

function firstToolUse(event) {
  if (event.type !== "assistant" || !Array.isArray(event.message?.content)) return null;
  const block = event.message.content.find((candidate) => candidate?.type === "tool_use");
  return block ?? null;
}

function humanUserText(event) {
  if (event.type !== "user") return null;
  const content = event.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content.find((block) => block?.type === "text");
  return typeof text?.text === "string" ? text.text : null;
}

function activeMinutes(events) {
  const times = events
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let activeMs = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap <= 3 * 60 * 1000) activeMs += Math.max(0, gap);
  }
  return round1(activeMs / 60_000);
}

function countConsecutiveTools(toolUses) {
  let longest = 0;
  let current = 0;
  let previous;
  for (const tool of toolUses) {
    if (tool.name === previous) current++;
    else current = 1;
    previous = tool.name;
    longest = Math.max(longest, current);
  }
  return longest;
}

function topTools(toolUses) {
  const counts = new Map();
  for (const tool of toolUses) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, count]) => `${name}×${count}`);
}

function makeEntry(record) {
  const { sessionIndex, sessionId, session, project, task, model, shipping, events, outputPath, byteLength } = record;
  const day = localDay(session.start);
  const ticket = ticketFor(sessionIndex);
  const owner = DEMO_NAMES[sessionIndex % DEMO_NAMES.length];
  const reviewer = DEMO_NAMES[(sessionIndex + 1) % DEMO_NAMES.length];
  const toolUses = events.map(firstToolUse).filter(Boolean);
  const bashCommands = toolUses
    .filter((tool) => tool.name === "Bash")
    .map((tool) => typeof tool.input?.command === "string" ? tool.input.command : "");
  const humanMessages = events.map(humanUserText).filter(Boolean);
  const assistantMessages = events.filter((event) => event.type === "assistant");
  const seenMessageIds = new Set();
  let tokensTotal = 0;
  const modelMix = {};
  for (const event of assistantMessages) {
    const message = event.message ?? {};
    modelMix[message.model] = (modelMix[message.model] ?? 0) + 1;
    if (!message.id || seenMessageIds.has(message.id)) continue;
    seenMessageIds.add(message.id);
    const usage = message.usage ?? {};
    tokensTotal += (usage.input_tokens ?? 0)
      + (usage.output_tokens ?? 0)
      + (usage.cache_creation_input_tokens ?? 0)
      + (usage.cache_read_input_tokens ?? 0);
  }
  const agentText = [...assistantMessages]
    .reverse()
    .flatMap((event) => Array.isArray(event.message?.content) ? event.message.content : [])
    .find((block) => block?.type === "text")?.text ?? "";
  const activeMin = activeMinutes(events);
  const prs = bashCommands.filter((command) => /\bgh\s+pr\s+create\b/i.test(command)).length;
  const commits = bashCommands.filter((command) => /\bgit\s+commit\b/i.test(command)).length;
  const pushes = bashCommands.filter((command) => /\bgit\s+push\b/i.test(command)).length;
  const flags = activeMin >= 20 ? ["long_autonomous"] : [];
  const focus = sanitizePerceptionText(task.title, ticket);
  const firstUser = `${ticket}: ${sanitizePerceptionText(humanMessages[0] ?? task.prompt, ticket)}`;
  const friction = sessionIndex % 4 === 0
    ? `${reviewer} found a stale fixture around ${ticket}; a focused rerun resolved it before review.`
    : sessionIndex % 7 === 0
      ? `${owner} narrowed a compatibility edge in ${project.name} before the final test pass.`
      : null;
  const buildMinutes = round1(activeMin * 0.65);
  const testMinutes = round1(Math.max(0, activeMin * 0.25));
  const generatedAt = new Date(Date.parse(events.at(-1).timestamp) + 60_000).toISOString();

  return {
    version: 2,
    agent: "claude-code",
    session_id: sessionId,
    local_day: day,
    project: canonicalDemoProject(session.cwd),
    start_iso: events[0].timestamp,
    end_iso: events.at(-1).timestamp,
    numbers: {
      active_min: activeMin,
      turn_count: humanMessages.length,
      tools_total: toolUses.length,
      subagent_calls: 0,
      skill_calls: 0,
      task_ops: 0,
      interrupts: 0,
      tool_errors: events.filter((event) =>
        Array.isArray(event.message?.content)
        && event.message.content.some((block) => block?.type === "tool_result" && block.is_error === true)
      ).length,
      consec_same_tool_max: countConsecutiveTools(toolUses),
      exit_plan_calls: 0,
      prs,
      commits,
      pushes,
      tokens_total: tokensTotal,
    },
    flags,
    primary_model: model,
    model_mix: modelMix,
    first_user: firstUser,
    final_agent: sanitizePerceptionText(agentText, ticket),
    pr_titles: shipping ? [focus] : [],
    edited_dirs: [path.posix.dirname(path.posix.join(session.cwd, task.file))],
    top_tools: topTools(toolUses),
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: sessionIndex % 6 === 0 ? 1 : 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: humanMessages.length, teammate: 0, skill_load: 0, slash_command: 0, system_instruction: 0 },
    enrichment: {
      status: "done",
      generated_at: generatedAt,
      model: "claude-sonnet-5",
      cost_usd: Number((0.012 + (sessionIndex % 8) * 0.0017).toFixed(4)),
      error: null,
      brief_summary: `${owner} completed ${ticket}: ${focus.toLowerCase()} in ${project.name}, with focused regression coverage.`,
      underlying_goal: `Move ${ticket} toward a reviewable, tested change without widening the fictional project scope.`,
      friction_detail: friction,
      user_instructions: [sanitizePerceptionText(task.prompt, ticket)],
      outcome: shipping ? "shipped" : sessionIndex % 11 === 0 ? "exploratory" : "partial",
      claude_helpfulness: shipping || sessionIndex % 5 === 0 ? "essential" : "helpful",
      goal_categories: task.title.startsWith("Fix") || task.title.startsWith("Stabilize")
        ? { debug: buildMinutes, test: testMinutes }
        : { build: buildMinutes, test: testMinutes },
      retry_count: 0,
    },
    signals: {
      working_shape: "solo-build",
      prompt_frames: [],
      subagent_roles: [],
      verbosity: firstUser.length < 100 ? "short" : "medium",
      external_refs: [{ kind: "ticket-ref", preview: ticket }],
      brainstorm_warmup: false,
      continuation_kind: "none",
    },
    generated_at: generatedAt,
    source_jsonl: outputPath,
    source_checkpoint: { byte_offset: byteLength, last_event_ts: events.at(-1).timestamp },
  };
}

function aggregateCounts(rows, keyOf, valueOf = () => 1) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + valueOf(row));
  }
  return counts;
}

function topCountRows(counts, key, value, limit = 5) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ [key]: name, [value]: round1(count) }));
}

function buildDayDigest(day, entries, dayIndex) {
  const totalMinutes = round1(entries.reduce((sum, entry) => sum + entry.numbers.active_min, 0));
  const projectMinutes = aggregateCounts(entries, (entry) => entry.project, (entry) => entry.numbers.active_min);
  const projects = [...projectMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, minutes]) => ({
      name,
      display_name: displayProject(name),
      share_pct: totalMinutes > 0 ? round1((minutes / totalMinutes) * 100) : 0,
      entry_count: entries.filter((entry) => entry.project === name).length,
    }));
  const shipped = entries.flatMap((entry) => entry.pr_titles.map((title) => ({
    title,
    project: displayProject(entry.project),
    session_id: entry.session_id,
  })));
  const flagCounts = new Map();
  const goalCounts = new Map();
  for (const entry of entries) {
    for (const flag of entry.flags) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
    for (const [goal, minutes] of Object.entries(entry.enrichment.goal_categories)) {
      goalCounts.set(goal, (goalCounts.get(goal) ?? 0) + minutes);
    }
  }
  const ticket = ticketFor(dayIndex + 100);
  const lead = DEMO_NAMES[dayIndex % DEMO_NAMES.length];
  const partner = DEMO_NAMES[(dayIndex + 1) % DEMO_NAMES.length];
  const projectLine = projects.slice(0, 2).map((project) => project.display_name).join(" and ") || "the demo workspace";
  const outcomeDay = shipped.length > 0 ? "shipped" : entries.some((entry) => entry.enrichment.outcome === "partial") ? "partial" : "exploratory";
  const verbosity = { short: 0, medium: 0, long: 0, very_long: 0 };
  for (const entry of entries) verbosity[entry.signals.verbosity]++;

  return {
    version: 2,
    scope: "day",
    key: day,
    window: { start: `${day}T00:00:00`, end: `${day}T23:59:59` },
    entry_refs: entries.map((entry) => `${entry.session_id}__${entry.local_day}`),
    generated_at: isoAtLocalTime(day, 23, 58),
    is_live: false,
    model: "claude-sonnet-5",
    cost_usd: Number((0.07 + (dayIndex % 5) * 0.011).toFixed(3)),
    projects,
    shipped,
    top_flags: topCountRows(flagCounts, "flag", "count"),
    top_goal_categories: topCountRows(goalCounts, "category", "minutes"),
    concurrency_peak: 2,
    agent_min: totalMinutes,
    agent_breakdown: [{
      agent: "claude-code",
      sessions: entries.length,
      active_min: totalMinutes,
      tools_total: entries.reduce((sum, entry) => sum + entry.numbers.tools_total, 0),
    }],
    outcome_day: outcomeDay,
    helpfulness_day: dayIndex % 3 === 0 ? "essential" : "helpful",
    day_signals: {
      dominant_shape: "solo-build",
      shape_distribution: { "solo-build": entries.length },
      skills_loaded: [],
      user_authored_skills_used: [],
      user_authored_subagents_used: [],
      prompt_frames: [],
      comm_style: {
        verbosity_distribution: verbosity,
        external_refs: entries.map((entry) => ({
          session_id: entry.session_id,
          kind: "ticket-ref",
          preview: entry.signals.external_refs[0].preview,
        })),
        steering: { interrupts: 0, frustrated: 0, dissatisfied: 0, sessions_with_mid_run_redirect: 0 },
      },
      brainstorm_warmup_session_count: 0,
      todo_ops_total: 0,
      plan_mode_used: false,
    },
    headline: `${lead} advanced ${ticket} across ${projectLine}`,
    narrative: `${lead} coordinated ${entries.length} fictional sessions across ${projectLine}. The day balanced implementation, focused tests, and concurrent review-ready work.`,
    what_went_well: `${partner} kept the ${ticket} changes narrow, and the targeted suites stayed green before handoff.`,
    what_hit_friction: dayIndex % 2 === 0
      ? `${lead} had to refresh a stale fixture before the final compatibility check passed.`
      : `${partner} spent extra time reconciling an older assertion with the new behavior.`,
    suggestion: {
      headline: "Keep the focused verification checkpoint",
      body: `For the next ${ticket} slice, run the smallest suite immediately after the first edit and again before review.`,
    },
    day_signature: `${entries.length} concurrent solo-build sessions moved ${ticket} from implementation through focused verification.`,
  };
}

function aggregateDigestRows(digests, field, keyName, valueName) {
  const counts = new Map();
  for (const digest of digests) {
    for (const row of digest[field]) {
      counts.set(row[keyName], (counts.get(row[keyName]) ?? 0) + row[valueName]);
    }
  }
  return topCountRows(counts, keyName, valueName);
}

function buildWeekDigest(monday, dayDigests, entries, weekIndex) {
  const dates = weekDays(monday);
  const byDay = new Map(dayDigests.map((digest) => [digest.key, digest]));
  const agentMinutes = round1(dayDigests.reduce((sum, digest) => sum + digest.agent_min, 0));
  const projectMinutes = new Map();
  const shippedCounts = new Map();
  for (const digest of dayDigests) {
    for (const project of digest.projects) {
      projectMinutes.set(project.name, (projectMinutes.get(project.name) ?? 0) + digest.agent_min * project.share_pct / 100);
    }
    for (const item of digest.shipped) {
      const match = digest.projects.find((project) => project.display_name === item.project);
      const key = match?.name ?? item.project;
      shippedCounts.set(key, (shippedCounts.get(key) ?? 0) + 1);
    }
  }
  const projects = [...projectMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, minutes]) => ({
      name,
      display_name: displayProject(name),
      agent_min: round1(minutes),
      share_pct: agentMinutes > 0 ? round1(minutes / agentMinutes * 100) : 0,
      shipped_count: shippedCounts.get(name) ?? 0,
      description: `${DEMO_NAMES[weekIndex % DEMO_NAMES.length]} moved tested ORB work through ${displayProject(name)} with a review-ready handoff.`,
    }));
  const shipped = dayDigests.flatMap((digest) => digest.shipped.map((item) => ({ ...item, date: digest.key })));
  const outcomeMix = aggregateCounts(dayDigests, (digest) => digest.outcome_day);
  const busiest = [...dayDigests].sort((a, b) => b.agent_min - a.agent_min)[0];
  const longest = [...entries].sort((a, b) => b.numbers.active_min - a.numbers.active_min)[0];
  const hoursDistribution = new Array(24).fill(0);
  for (const entry of entries) {
    const hour = new Date(entry.start_iso).getHours();
    hoursDistribution[hour] = round1(hoursDistribution[hour] + entry.numbers.active_min);
  }
  const lead = DEMO_NAMES[weekIndex % DEMO_NAMES.length];
  const partner = DEMO_NAMES[(weekIndex + 2) % DEMO_NAMES.length];
  const ticket = ticketFor(weekIndex + 150);
  const standoutSource = [...dayDigests].sort((a, b) => b.agent_min - a.agent_min).slice(0, 2);
  const longestTurn = longest ? {
    date: longest.local_day,
    project_display: displayProject(longest.project),
    active_min: longest.numbers.active_min,
    top_tools: longest.top_tools,
    first_user_preview: longest.first_user,
  } : null;

  return {
    version: 2,
    scope: "week",
    key: monday,
    window: { start: `${monday}T00:00:00`, end: `${dates[6]}T23:59:59` },
    day_refs: dayDigests.map((digest) => digest.key).sort(),
    generated_at: isoAtLocalTime(dates[6], 23, 58),
    is_live: false,
    model: "claude-opus-4-8",
    cost_usd: Number((0.31 + weekIndex * 0.047).toFixed(3)),
    agent_min_total: agentMinutes,
    projects,
    shipped,
    outcome_mix: Object.fromEntries(outcomeMix),
    helpfulness_sparkline: dates.map((date) => byDay.get(date)?.helpfulness_day ?? null),
    top_flags: aggregateDigestRows(dayDigests, "top_flags", "flag", "count"),
    top_goal_categories: aggregateDigestRows(dayDigests, "top_goal_categories", "category", "minutes"),
    concurrency_peak_day: dayDigests.length > 0 ? { date: busiest.key, peak: busiest.concurrency_peak } : null,
    days_active: dayDigests.map((digest) => ({
      date: digest.key,
      agent_min: digest.agent_min,
      shipped_count: digest.shipped.length,
      outcome_day: digest.outcome_day,
      helpfulness_day: digest.helpfulness_day,
      dominant_shape: digest.day_signals?.dominant_shape ?? null,
    })),
    busiest_day: busiest ? { date: busiest.key, agent_min: busiest.agent_min, shipped_count: busiest.shipped.length } : null,
    longest_run: longest ? {
      session_id: longest.session_id,
      date: longest.local_day,
      project_display: displayProject(longest.project),
      active_min: longest.numbers.active_min,
    } : null,
    hours_distribution: hoursDistribution,
    interaction_modes: {
      orchestration: { subagent_calls: 0, task_ops: 0, days_with_subagents: 0, top_types: [], examples: [] },
      skill_use: { skill_calls: 0, days_with_skills: 0, top_skills: [], examples: [] },
      plan_gating: { exit_plan_calls: 0, days_with_plan: 0 },
      turn_shape: {
        tools_per_turn: round1(entries.reduce((sum, entry) => sum + entry.numbers.tools_total, 0) / Math.max(1, entries.reduce((sum, entry) => sum + entry.numbers.turn_count, 0))),
        interrupts: 0,
        long_autonomous_days: dayDigests.filter((digest) => digest.top_flags.some((flag) => flag.flag === "long_autonomous")).length,
        label: "batch",
        longest_turn: longestTurn,
      },
    },
    working_shapes: entries.length > 0 ? [{
      shape: "solo-build",
      occurrences: entries.slice(0, 5).map((entry) => ({
        date: entry.local_day,
        session_id: entry.session_id,
        project_display: displayProject(entry.project),
        outcome: entry.enrichment.outcome,
        helpfulness: entry.enrichment.claude_helpfulness,
        evidence_subagent: null,
        evidence_first_user: entry.first_user,
        day_signature: byDay.get(entry.local_day)?.day_signature ?? null,
      })),
      outcome_distribution: Object.fromEntries(aggregateCounts(entries, (entry) => entry.enrichment.outcome)),
    }] : null,
    interaction_grammar: null,
    top_sessions: [],
    headline: `${lead} turned concurrent ${ticket} work into ${shipped.length} review-ready shipments`,
    trajectory: dayDigests.map((digest, index) => ({
      date: digest.key,
      line: `${DEMO_NAMES[(weekIndex + index) % DEMO_NAMES.length]} advanced ${ticketFor(weekIndex * 10 + index)} across ${digest.projects.slice(0, 2).map((project) => project.display_name).join(" and ")}.`,
    })),
    standout_days: standoutSource.map((digest) => ({
      date: digest.key,
      why: `${partner} coordinated ${digest.entry_refs.length} sessions and ${round1(digest.agent_min)} agent-min with a clean verification handoff.`,
    })),
    key_pattern: "Concurrent solo-build sessions stayed effective when each change ended with a focused test checkpoint.",
    what_worked: [{
      title: "Focused verification held across parallel work",
      detail: `${lead} kept ORB changes narrow while several sessions progressed in the same hour.`,
      anchor: "solo-build",
      evidence: { date: busiest?.key ?? monday, quote: busiest?.what_went_well ?? `${ticket} stayed reviewable.` },
    }],
    what_stalled: [{
      title: "Fixture refreshes added avoidable drag",
      detail: `${partner} encountered stale expectations on two otherwise clean ORB paths.`,
      anchor: "solo-build",
      evidence: { date: busiest?.key ?? monday, quote: busiest?.what_hit_friction ?? "A stale fixture needed a focused rerun." },
    }],
    what_surprised: [{
      title: "Cross-project overlap remained predictable",
      detail: "Orbit-shop and fleet-dashboard sessions overlapped without widening their individual change sets.",
      anchor: "solo-build",
      evidence: { date: busiest?.key ?? monday, quote: "Concurrent sessions retained focused verification boundaries." },
      surprise_kind: "cross-week-contrast",
    }],
    where_to_lean: [{
      title: "Standardize the first focused test",
      detail: `Start each ${ticket} session by naming the smallest regression suite before editing.`,
      anchor: "solo-build",
      evidence: { date: busiest?.key ?? monday, quote: busiest?.suggestion.body ?? "Run the smallest suite after the first edit." },
      lean_kind: "decision",
      copyable: `For ${ticket}, identify the smallest regression suite, implement the narrow change, and rerun it before review.`,
    }],
    recurring_themes: null,
    outcome_correlations: null,
    friction_categories: null,
    suggestions: null,
    on_the_horizon: null,
    fun_ending: null,
  };
}

function buildMonthDigest(yearMonth, dayDigests, entries) {
  const monthMinutes = round1(entries.reduce((sum, entry) => sum + entry.numbers.active_min, 0));
  const projectMinutes = aggregateCounts(entries, (entry) => entry.project, (entry) => entry.numbers.active_min);
  const shippedCounts = aggregateCounts(entries.flatMap((entry) => entry.pr_titles.map(() => entry)), (entry) => entry.project);
  const projects = [...projectMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, minutes]) => ({
      name,
      display_name: displayProject(name),
      agent_min: round1(minutes),
      share_pct: monthMinutes > 0 ? round1(minutes / monthMinutes * 100) : 0,
      shipped_count: shippedCounts.get(name) ?? 0,
    }));
  const shipped = entries.flatMap((entry) => entry.pr_titles.map((title) => ({
    title,
    project: displayProject(entry.project),
    date: entry.local_day,
    session_id: entry.session_id,
  })));
  const monthMondays = mondaysInMonth(yearMonth);
  const dayByKey = new Map(dayDigests.map((digest) => [digest.key, digest]));
  const outcomeMix = aggregateCounts(dayDigests, (digest) => digest.outcome_day);
  const peakDay = [...dayDigests].sort((a, b) => b.concurrency_peak - a.concurrency_peak)[0];
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = localDay(new Date(year, month, 0));

  return {
    version: 2,
    scope: "month",
    key: yearMonth,
    window: { start: `${yearMonth}-01T00:00:00`, end: `${lastDay}T23:59:59` },
    week_refs: monthMondays,
    generated_at: isoAtLocalTime(lastDay, 23, 58),
    is_live: false,
    model: "claude-opus-4-8",
    cost_usd: 0.84,
    agent_min_total: monthMinutes,
    projects,
    shipped,
    outcome_mix: Object.fromEntries(outcomeMix),
    helpfulness_by_week: monthMondays.map((monday) => {
      const level = weekDays(monday).map((day) => dayByKey.get(day)?.helpfulness_day).find(Boolean) ?? null;
      return { week_start: monday, helpfulness: level };
    }),
    top_flags: aggregateDigestRows(dayDigests, "top_flags", "flag", "count"),
    top_goal_categories: aggregateDigestRows(dayDigests, "top_goal_categories", "category", "minutes"),
    concurrency_peak_week: peakDay ? { week_start: localDay(isoWeekMonday(dateFromLocalDay(peakDay.key))), peak: peakDay.concurrency_peak } : null,
    headline: "Erin turned the demo month into a tested ORB delivery rhythm",
    trajectory: monthMondays.map((monday, index) => {
      const activeDays = weekDays(monday).map((day) => dayByKey.get(day)).filter(Boolean);
      return {
        week_start: monday,
        line: activeDays.length > 0
          ? `${DEMO_NAMES[index % DEMO_NAMES.length]} moved ${ticketFor(200 + index)} through ${activeDays.length} active days of focused implementation and review.`
          : `${DEMO_NAMES[index % DEMO_NAMES.length]} kept this pre-fixture week intentionally empty.`,
      };
    }),
    standout_weeks: monthMondays
      .map((monday) => ({ monday, activeDays: weekDays(monday).map((day) => dayByKey.get(day)).filter(Boolean) }))
      .filter((row) => row.activeDays.length > 0)
      .slice(-2)
      .map((row, index) => ({
        week_start: row.monday,
        why: `${DEMO_NAMES[(index + 2) % DEMO_NAMES.length]} kept orbit-shop and fleet-dashboard work moving through explicit test checkpoints.`,
      })),
    friction_themes: "Alice repeatedly found stale fixtures at compatibility boundaries, but each issue stayed local to a focused rerun.",
    suggestion: {
      headline: "Preserve the narrow ORB handoff pattern",
      body: "Bob should keep pairing every implementation slice with one named regression suite and a short review note.",
    },
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function generatePerceptionArtifacts({ home, todayStart, endDay, generatedSessions }) {
  const entries = generatedSessions.map(makeEntry);
  const entriesByDay = new Map();
  for (const entry of entries) {
    const list = entriesByDay.get(entry.local_day) ?? [];
    list.push(entry);
    entriesByDay.set(entry.local_day, list);
  }
  const allDayDigests = new Map(
    [...entriesByDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, dayEntries], index) => [day, buildDayDigest(day, dayEntries, index)]),
  );
  const entriesRoot = path.join(home, ".cclens", "entries");
  const digestsRoot = path.join(home, ".cclens", "digests");

  for (const entry of entries) {
    await writeJson(path.join(entriesRoot, `${entry.session_id}__${entry.local_day}.json`), entry);
  }

  const persistedDayKeys = Array.from({ length: 8 }, (_, index) => shiftLocalDay(localDay(endDay), index - 7));
  for (const day of persistedDayKeys) {
    const digest = allDayDigests.get(day) ?? buildDayDigest(day, [], persistedDayKeys.indexOf(day));
    await writeJson(path.join(digestsRoot, "day", `${day}.json`), digest);
  }

  const currentMonday = isoWeekMonday(todayStart);
  const weekMondays = [
    localDay(new Date(currentMonday.getTime() - 14 * DAY_MS)),
    localDay(new Date(currentMonday.getTime() - 7 * DAY_MS)),
  ];
  const weekDigests = weekMondays.map((monday, index) => {
    const dates = new Set(weekDays(monday));
    const days = [...allDayDigests.values()].filter((digest) => dates.has(digest.key));
    const weekEntries = entries.filter((entry) => dates.has(entry.local_day));
    return buildWeekDigest(monday, days, weekEntries, index);
  });
  for (const digest of weekDigests) {
    await writeJson(path.join(digestsRoot, "week", `${digest.key}.json`), digest);
  }

  const previousMonthEnd = new Date(todayStart.getFullYear(), todayStart.getMonth(), 0);
  const previousMonth = monthKey(previousMonthEnd);
  const monthEntries = entries.filter((entry) => entry.local_day.startsWith(previousMonth));
  const monthDays = [...allDayDigests.values()].filter((digest) => digest.key.startsWith(previousMonth));
  const monthDigest = buildMonthDigest(previousMonth, monthDays, monthEntries);
  await writeJson(path.join(digestsRoot, "month", `${previousMonth}.json`), monthDigest);

  return {
    entries: entries.length,
    dayDigests: persistedDayKeys.length,
    weekDigests: weekDigests.length,
    monthDigests: 1,
  };
}

async function main() {
  const { home, days, perception } = parseArgs(process.argv.slice(2));
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endDay = new Date(todayStart.getTime() - DAY_MS);
  const seed = `fleetlens-demo:${localDay(endDay)}:${days}`;
  const rng = createRng(seed);
  const { sessions, startDay } = scheduleSessions(days, endDay, rng);
  const sidechainIndexes = selectSidechainIndexes(sessions.length);
  const transcriptRoot = path.join(home, ".claude", "projects");
  const writtenDirs = new Set();
  const generatedSessions = [];
  let shippingSessions = 0;

  for (let sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
    const session = sessions[sessionIndex];
    const project = PROJECTS[session.projectIndex];
    const task = project.tasks[(session.dayIndex + session.daySlot + sessionIndex) % project.tasks.length];
    const model = MODELS[(sessionIndex + session.dayIndex) % MODELS.length];
    const shipping = session.durationMinutes >= 42 && sessionIndex % 4 === 0;
    if (shipping) shippingSessions++;
    const actionCount = Math.max(4, Math.min(13, Math.floor(session.durationMinutes / 8) + 3));
    const descriptors = buildDescriptors(task, session.cwd, shipping, actionCount);
    const gaps = eventGaps(session.durationMinutes, descriptors.length, rng);
    const dayKey = localDay(session.start);
    const sessionKey = `${seed}:${dayKey}:${session.daySlot}:${project.name}:${session.cwd}`;
    const sessionId = deterministicUuid(`${sessionKey}:session`);
    const branch = branchFor(task, sessionIndex);
    const mainEvents = buildMainEvents({
      descriptors,
      gaps,
      sessionKey,
      sessionId,
      cwd: session.cwd,
      branch,
      model,
      start: session.start,
      rng,
    });
    const events = sidechainIndexes.has(sessionIndex)
      ? [...mainEvents, ...buildSidechain({ sessionKey, sessionId, cwd: session.cwd, branch, model, mainEvents, rng })]
      : mainEvents;
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const projectDir = encodeProjectDir(session.cwd);
    const outputDir = path.join(transcriptRoot, projectDir);
    const outputPath = path.join(outputDir, `${sessionId}.jsonl`);
    const jsonl = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, jsonl, "utf8");
    generatedSessions.push({
      sessionIndex,
      sessionId,
      session,
      project,
      task,
      model,
      shipping,
      events,
      outputPath,
      byteLength: Buffer.byteLength(jsonl),
    });
    writtenDirs.add(projectDir);
  }

  const perceptionSummary = perception
    ? await generatePerceptionArtifacts({ home, todayStart, endDay, generatedSessions })
    : null;

  console.log(`Generated ${sessions.length} fictional Claude Code sessions across ${days} days.`);
  console.log(`Home: ${home}`);
  console.log(`Transcript root: ${transcriptRoot}`);
  console.log(`Date range: ${localDay(startDay)} through ${localDay(endDay)} (ending yesterday)`);
  console.log(`Projects: ${PROJECTS.length} canonical projects in ${writtenDirs.size} encoded directories`);
  console.log(`Extras: 1 worktree session, ${sidechainIndexes.size} inline sidechains, ${shippingSessions} shipping sessions`);
  if (perceptionSummary) {
    console.log(`Perception: ${perceptionSummary.entries} enriched entries, ${perceptionSummary.dayDigests} day digests, ${perceptionSummary.weekDigests} week digests, ${perceptionSummary.monthDigests} month digest`);
    console.log(`Perception root: ${path.join(home, ".cclens")}`);
  }
  console.log(`Deterministic seed: ${seed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage());
  process.exitCode = 1;
});
