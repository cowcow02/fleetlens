// Jira Cloud REST v3 client for the team integration. Auth is Basic
// base64(email:api_token) — the token is the encrypted credential, the site
// (e.g. https://acme.atlassian.net) and email live in the integration config.
// Jira has no native "started" timestamp like Linear's startedAt, so cycle
// time needs the issue changelog: started = first transition into an
// In-Progress (statusCategory "indeterminate") status. Status names are
// per-project custom workflows, so we map names→category via the instance
// status catalog and never hard-code workflow names.

// Same 30s cap as the other integrations — a hung connection would otherwise
// stall the hourly scheduler sweep and the inline connect-flow sync.
const FETCH_TIMEOUT_MS = 30_000;

// Jira's most common default story-points field. Instances vary; this is the
// fallback when the config doesn't pin one. Estimate is optional anyway.
export const DEFAULT_STORY_POINTS_FIELD = "customfield_10016";

function authHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

/** Trim a user-entered site to a bare https origin (no trailing slash/path). */
export function normalizeSite(raw: string): string {
  let s = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return s;
  }
}

async function api<T>(
  site: string,
  email: string,
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${site}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: authHeader(email, token),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Jira rejected the credentials (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`Jira rejected the request (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export async function validateJiraCredentials(
  site: string,
  email: string,
  token: string,
): Promise<{ name: string; email: string }> {
  const me = await api<{ displayName?: string; emailAddress?: string }>(site, email, token, "/rest/api/3/myself");
  return { name: me.displayName ?? email, email: me.emailAddress ?? email };
}

export type JiraProjectOption = { id: string; key: string; name: string };

export async function listJiraProjects(
  site: string,
  email: string,
  token: string,
): Promise<JiraProjectOption[]> {
  const out: JiraProjectOption[] = [];
  let startAt = 0;
  // Page cap is a runaway guard; 20 × 50 ≫ any team's project count.
  for (let page = 0; page < 20; page++) {
    const d = await api<{ values: JiraProjectOption[]; isLast?: boolean; total?: number }>(
      site, email, token, `/rest/api/3/project/search?maxResults=50&startAt=${startAt}`,
    );
    out.push(...d.values.map((p) => ({ id: p.id, key: p.key, name: p.name })));
    if (d.isLast || d.values.length === 0) break;
    startAt += d.values.length;
  }
  return out;
}

// statusCategory.key is Jira's stable 3-bucket classification across every
// custom workflow: "new" (To Do), "indeterminate" (In Progress), "done".
export type JiraStatusCategory = "new" | "indeterminate" | "done";

export async function fetchStatusCategories(
  site: string,
  email: string,
  token: string,
): Promise<Map<string, JiraStatusCategory>> {
  const statuses = await api<Array<{ id: string; name: string; statusCategory?: { key?: string } }>>(
    site, email, token, "/rest/api/3/status",
  );
  const map = new Map<string, JiraStatusCategory>();
  for (const s of statuses) {
    const key = s.statusCategory?.key;
    if (key === "new" || key === "indeterminate" || key === "done") {
      // Index by both id and name — changelog items carry ids in `to` and
      // names in `toString`; either resolves.
      map.set(s.id, key);
      map.set(s.name.toLowerCase(), key);
    }
  }
  return map;
}

export type JiraChangelogItem = { field: string; from: string | null; to: string | null; fromString: string | null; toString: string | null };
export type JiraChangelogHistory = { created: string; items: JiraChangelogItem[] };

export type JiraIssueNode = {
  key: string;
  fields: {
    summary?: string;
    created: string;
    resolutiondate?: string | null;
    statuscategorychangedate?: string | null;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string } | null;
    resolution?: { name?: string } | null;
    project?: { key?: string };
    [custom: string]: unknown;
  };
  // The search endpoint returns the changelog inline but capped at `maxResults`
  // histories; `total` reveals when it's truncated so we can refetch in full.
  changelog?: { histories: JiraChangelogHistory[]; total?: number; maxResults?: number };
};

// Jira project keys are letters/digits starting with a letter. fetchJiraIssues
// interpolates them straight into JQL (`project in (...)`), so — unlike the
// parameterised GraphQL of the Linear path — a key with quotes or spaces would
// break or broaden the query. Validate before it ever reaches JQL or the DB.
export function isSafeProjectKey(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(key);
}

export type JiraIssueRow = {
  identifier: string;
  title: string;
  stateName: string;
  stateType: string; // Linear-vocabulary bucket so the shared aggregation works
  projectKey: string;
  assignee: string | null;
  estimate: number | null;
  url: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
};

// Report queries interpolate stored identifiers into Postgres regexes
// (`title ~* identifier || '\M'`), so only regex-safe identifiers may enter
// the DB. Jira guarantees KEY-NUMBER with alphanumeric keys; this guard makes
// that a local invariant instead of trusting the external API.
export function isSafeIdentifier(identifier: string): boolean {
  return /^[A-Za-z0-9]+-\d+$/.test(identifier);
}

// "not really completed" resolutions — kept broad because the built-in Jira
// set includes Won't Do, Won't Fix, Cannot Reproduce, Duplicate, Declined,
// Rejected. `won'?t\b` catches both Won't Do and Won't Fix; the rest are
// matched by stem so plurals/variants ("Duplicates", "Declined") still hit.
const CANCEL_RESOLUTION_RE = /cancel|won'?t\b|abandon|duplicat|declin|reject|wontfix|cannot\s*reproduce|not\s*a\s*bug/i;

// Timestamp of the first changelog transition INTO a status of `target`
// category, or null. Used for pickup (indeterminate) and as a completion
// fallback (done) when the issue carries no resolutiondate.
function firstTransitionInto(
  node: JiraIssueNode,
  categories: Map<string, JiraStatusCategory>,
  target: JiraStatusCategory,
): string | null {
  const histories = node.changelog?.histories ?? [];
  // Jira returns histories ascending by created; sort defensively.
  const sorted = [...histories].sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  for (const h of sorted) {
    for (const it of h.items) {
      if (it.field !== "status") continue;
      const cat =
        (it.to && categories.get(it.to)) ??
        (it.toString && categories.get(it.toString.toLowerCase()));
      if (cat === target) return h.created;
    }
  }
  return null;
}

// First changelog transition INTO an indeterminate-category status = pickup.
export function deriveStartedAt(
  node: JiraIssueNode,
  categories: Map<string, JiraStatusCategory>,
): string | null {
  return firstTransitionInto(node, categories, "indeterminate");
}

// Completion time, most reliable first: the resolution date, else the
// changelog's first transition into a done-category status, else the field
// Jira stamps when the status category last changed. Without this fallback a
// Done workflow that sets no resolution would leave completed_at NULL and the
// issue would silently drop out of the weekly velocity + timeline windows.
export function deriveCompletedAt(
  node: JiraIssueNode,
  categories: Map<string, JiraStatusCategory>,
): string | null {
  return (
    (node.fields.resolutiondate ?? null) ||
    firstTransitionInto(node, categories, "done") ||
    (node.fields.statuscategorychangedate ?? null)
  );
}

export function toIssueRow(
  node: JiraIssueNode,
  categories: Map<string, JiraStatusCategory>,
  site: string,
  storyPointsField: string,
): JiraIssueRow {
  const f = node.fields;
  const statusName = f.status?.name ?? "Unknown";
  const category =
    (f.status?.statusCategory?.key as JiraStatusCategory | undefined) ??
    categories.get(statusName.toLowerCase()) ??
    "new";
  const resolution = f.resolution?.name ?? null;
  const isCancel = !!resolution && CANCEL_RESOLUTION_RE.test(resolution);

  let stateType: string;
  if (category === "done") stateType = isCancel ? "canceled" : "completed";
  else if (category === "indeterminate") stateType = "started";
  else stateType = "unstarted";

  // Story points may arrive as a number or, on some (team-managed / text) field
  // configs, a numeric string — coerce both; the DB column is integer.
  const sp = f[storyPointsField];
  const spNum = typeof sp === "number" ? sp : typeof sp === "string" && sp.trim() !== "" ? Number(sp) : NaN;
  const estimate = Number.isFinite(spNum) ? Math.round(spNum) : null;
  // Both completed and canceled land in the done category; resolve the end
  // time the same way for either bucket.
  const endAt = stateType === "completed" || stateType === "canceled" ? deriveCompletedAt(node, categories) : null;

  return {
    identifier: node.key,
    title: f.summary ?? node.key,
    stateName: statusName,
    stateType,
    projectKey: f.project?.key ?? node.key.split("-")[0]!,
    assignee: f.assignee?.displayName ?? null,
    estimate,
    url: `${site}/browse/${node.key}`,
    createdAt: f.created,
    startedAt: deriveStartedAt(node, categories),
    completedAt: stateType === "completed" ? endAt : null,
    canceledAt: stateType === "canceled" ? endAt : null,
  };
}

// Full changelog for one issue via the dedicated paginated endpoint, used only
// when the inline changelog from search came back truncated. Oldest-first, so
// the first status transition is guaranteed present.
async function fetchFullHistories(
  site: string, email: string, token: string, key: string,
): Promise<JiraChangelogHistory[]> {
  const out: JiraChangelogHistory[] = [];
  let startAt = 0;
  for (let page = 0; page < 20; page++) {
    const d = await api<{ values: JiraChangelogHistory[]; isLast?: boolean; total?: number }>(
      site, email, token, `/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=100`,
    );
    out.push(...(d.values ?? []));
    startAt += d.values?.length ?? 0;
    if (d.isLast || !d.values?.length || (d.total != null && startAt >= d.total)) break;
  }
  return out;
}

/** Issues updated within the trailing `sinceDays`, limited to the given Jira
 *  project keys. Pulls the changelog inline (`expand: "changelog"`) to derive
 *  pickup/done times, refetching the full changelog for any issue whose inline
 *  copy was truncated. Uses the enhanced search endpoint `/rest/api/3/search/jql`
 *  — the classic `/rest/api/3/search` was removed from Jira Cloud (returns 410,
 *  Atlassian CHANGE-2046). That endpoint paginates by opaque `nextPageToken`
 *  (no `total`/`startAt`) and takes `expand` as a string, not an array. */
export async function fetchJiraIssues(
  site: string,
  email: string,
  token: string,
  projectKeys: string[],
  sinceDays: number,
  storyPointsField: string = DEFAULT_STORY_POINTS_FIELD,
): Promise<JiraIssueRow[]> {
  // Drop any key that isn't JQL-safe before it reaches the interpolated query.
  const safeKeys = projectKeys.filter(isSafeProjectKey);
  if (safeKeys.length === 0) return [];
  const categories = await fetchStatusCategories(site, email, token);
  const jql =
    `project in (${safeKeys.join(",")}) AND updated >= -${sinceDays}d ORDER BY updated DESC`;
  const fields = ["summary", "status", "assignee", "created", "resolutiondate", "statuscategorychangedate", "resolution", "project", storyPointsField];

  const nodes: JiraIssueNode[] = [];
  let nextPageToken: string | undefined;
  // Stop if a cursor ever repeats — guards against a misbehaving/proxied server
  // returning a cyclic cursor (A→B→A) that the page cap alone would let spin.
  const seenTokens = new Set<string>();
  // Page cap is a runaway guard; 30 × 100 ≫ any 60-day window.
  for (let page = 0; page < 30; page++) {
    const d = await api<{ issues: JiraIssueNode[]; isLast?: boolean; nextPageToken?: string }>(
      site, email, token, "/rest/api/3/search/jql",
      { method: "POST", body: { jql, maxResults: 100, fields, expand: "changelog", ...(nextPageToken ? { nextPageToken } : {}) } },
    );
    nodes.push(...d.issues.filter((n) => isSafeIdentifier(n.key)));
    if (d.isLast || !d.nextPageToken || d.issues.length === 0 || seenTokens.has(d.nextPageToken)) break;
    seenTokens.add(d.nextPageToken);
    nextPageToken = d.nextPageToken;
  }

  // Refetch the full changelog for issues whose inline copy was capped, so the
  // earliest status transition (needed for pickup time) isn't missed. Truncation
  // shows as total>returned; when the server omits `total`, a page that exactly
  // fills maxResults is treated as possibly-capped and refetched defensively.
  for (const n of nodes) {
    const cl = n.changelog;
    const truncated = cl
      ? cl.total != null
        ? cl.total > cl.histories.length
        : cl.maxResults != null && cl.histories.length >= cl.maxResults
      : false;
    if (cl && truncated) {
      n.changelog = { histories: await fetchFullHistories(site, email, token, n.key) };
    }
  }

  return nodes.map((n) => toIssueRow(n, categories, site, storyPointsField));
}
