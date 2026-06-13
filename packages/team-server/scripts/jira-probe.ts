// Live probe for the Jira Cloud client — validates the real REST calls the
// integration depends on, without going near the DB or the connect UI.
//
// Run it with YOUR OWN credentials in env (the token never touches chat):
//
//   JIRA_SITE=your-team.atlassian.net \
//   JIRA_EMAIL=you@company.com \
//   JIRA_TOKEN=ATATT... \
//   [JIRA_PROJECT=ENG] [JIRA_SYNC_DAYS=60] \
//   npx vite-node scripts/jira-probe.ts
//
// It runs each step the hourly sync uses and prints what came back, so any
// instance-specific surprise (the /search endpoint, changelog shape, the
// story-points field) surfaces immediately.

import {
  validateJiraCredentials,
  listJiraProjects,
  fetchStatusCategories,
  fetchJiraIssues,
  normalizeSite,
  DEFAULT_STORY_POINTS_FIELD,
} from "../src/lib/jira.js";

const rawSite = process.env.JIRA_SITE;
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_TOKEN;
const spField = process.env.JIRA_STORY_POINTS_FIELD || DEFAULT_STORY_POINTS_FIELD;
const syncDays = Number(process.env.JIRA_SYNC_DAYS || "60");

if (!rawSite || !email || !token) {
  console.error("Set JIRA_SITE, JIRA_EMAIL and JIRA_TOKEN in the environment. See the header comment.");
  process.exit(1);
}
const site = normalizeSite(rawSite);
console.log(`site: ${site}  email: ${email}  storyPointsField: ${spField}\n`);

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const t = Date.now();
    const out = await fn();
    console.log(`✓ ${label}  (${Date.now() - t}ms)`);
    return out;
  } catch (err) {
    console.error(`✗ ${label}\n    ${(err as Error).message}`);
    return null;
  }
}

const viewer = await step("validate credentials (GET /myself)", () =>
  validateJiraCredentials(site, email, token),
);
if (viewer) console.log(`    → ${viewer.name} <${viewer.email}>\n`);

const projects = await step("list projects (GET /project/search)", () => listJiraProjects(site, email, token));
if (projects) {
  console.log(`    → ${projects.length} projects: ${projects.slice(0, 15).map((p) => p.key).join(", ")}${projects.length > 15 ? " …" : ""}\n`);
}

const cats = await step("status catalog (GET /status)", () => fetchStatusCategories(site, email, token));
if (cats) {
  const counts = { new: 0, indeterminate: 0, done: 0 };
  for (const v of new Set(cats.values())) void v; // touch
  for (const v of cats.values()) counts[v]++;
  console.log(`    → ${cats.size} name/id entries · categories present: ${Object.entries(counts).filter(([, n]) => n).map(([k]) => k).join(", ")}\n`);
}

const projectKey = process.env.JIRA_PROJECT || projects?.[0]?.key;
if (!projectKey) {
  console.error("No project to fetch issues from — set JIRA_PROJECT or ensure the account can see one.");
  process.exit(1);
}

const rows = await step(`fetch issues for ${projectKey} (POST /search, last ${syncDays}d, +changelog)`, () =>
  fetchJiraIssues(site, email, token, [projectKey], syncDays, spField),
);
if (rows) {
  const completed = rows.filter((r) => r.stateType === "completed");
  const withStart = rows.filter((r) => r.startedAt).length;
  const withEstimate = rows.filter((r) => r.estimate != null).length;
  console.log(
    `    → ${rows.length} issues · ${completed.length} completed · ${withStart} have a derived start time · ${withEstimate} have story points\n`,
  );
  console.log("    sample (up to 8):");
  for (const r of rows.slice(0, 8)) {
    console.log(
      `      ${r.identifier.padEnd(10)} ${r.stateType.padEnd(10)} est=${String(r.estimate ?? "—").padEnd(3)} ` +
        `started=${r.startedAt ? r.startedAt.slice(0, 10) : "—"} done=${r.completedAt ? r.completedAt.slice(0, 10) : "—"}  ${r.title.slice(0, 48)}`,
    );
  }
  if (withStart === 0 && completed.length > 0) {
    console.log(
      `\n    ⚠ No started times derived despite completed issues — the changelog may not be inline on /search ` +
        `for this instance (newer Cloud sites use /search/jql). Cycle time + the work-timeline build phase ` +
        `would be empty; tell Claude and the client can switch endpoints.`,
    );
  }
}

console.log("\nProbe done. If every step shows ✓ and issues/estimates look right, the connect flow will work the same way.");
