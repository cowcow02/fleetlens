// Linear GraphQL client for the team integration. Auth is a personal API key
// (lin_api_…) sent as a bare Authorization header — Linear does not use the
// Bearer scheme for personal keys. Cycle/lead times come from Linear's native
// startedAt/completedAt; per-status transition history is a later expansion.

const API = "https://api.linear.app/graphql";

// 30s cap on every Linear call — a hung connection would otherwise stall the
// hourly scheduler sweep (and the inline connect-flow sync) indefinitely.
const FETCH_TIMEOUT_MS = 30_000;

async function gql<T>(apiKey: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Linear rejected the request (HTTP ${res.status})`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Linear API error: ${body.errors[0].message}`);
  if (!body.data) throw new Error("Linear API returned no data");
  return body.data;
}

export async function validateLinearKey(apiKey: string): Promise<{ name: string; email: string }> {
  const d = await gql<{ viewer: { name: string; email: string } }>(apiKey, `query { viewer { name email } }`);
  return d.viewer;
}

export type LinearTeamOption = { id: string; key: string; name: string };

export async function listLinearTeams(apiKey: string): Promise<LinearTeamOption[]> {
  const d = await gql<{ teams: { nodes: LinearTeamOption[] } }>(
    apiKey,
    `query { teams(first: 100) { nodes { id key name } } }`,
  );
  return d.teams.nodes;
}

export type LinearIssueNode = {
  identifier: string;
  title: string;
  url: string | null;
  estimate: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  state: { name: string; type: string };
  team: { key: string };
  assignee: { displayName: string } | null;
};

export type LinearIssueRow = {
  identifier: string;
  title: string;
  stateName: string;
  stateType: string;
  linearTeamKey: string;
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
// the DB. Linear guarantees KEY-NUMBER with alphanumeric keys; this guard
// makes that a local invariant instead of trusting the external API.
export function isSafeIdentifier(identifier: string): boolean {
  return /^[A-Za-z0-9]+-\d+$/.test(identifier);
}

export function toIssueRow(n: LinearIssueNode): LinearIssueRow {
  return {
    identifier: n.identifier,
    title: n.title,
    stateName: n.state.name,
    stateType: n.state.type,
    linearTeamKey: n.team.key,
    assignee: n.assignee?.displayName ?? null,
    estimate: n.estimate,
    url: n.url,
    createdAt: n.createdAt,
    startedAt: n.startedAt,
    completedAt: n.completedAt,
    canceledAt: n.canceledAt,
  };
}

const ISSUES_QUERY = `
query ($filter: IssueFilter, $cursor: String) {
  issues(first: 100, after: $cursor, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      identifier title url estimate
      createdAt startedAt completedAt canceledAt
      state { name type }
      team { key }
      assignee { displayName }
    }
  }
}`;

/** Issues updated within the trailing `sinceDays`, optionally limited to
 *  specific Linear team keys (e.g. ["ORB"]). */
export async function fetchLinearIssues(
  apiKey: string,
  teamKeys: string[],
  sinceDays: number,
): Promise<LinearIssueRow[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const filter: Record<string, unknown> = { updatedAt: { gt: since } };
  if (teamKeys.length > 0) filter.team = { key: { in: teamKeys } };

  const rows: LinearIssueRow[] = [];
  let cursor: string | null = null;
  // Page cap is a runaway guard; 30 pages × 100 issues ≫ any 60-day window.
  for (let page = 0; page < 30; page++) {
    const d = await gql<{
      issues: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: LinearIssueNode[] };
    }>(apiKey, ISSUES_QUERY, { filter, cursor });
    rows.push(...d.issues.nodes.filter((n) => isSafeIdentifier(n.identifier)).map(toIssueRow));
    if (!d.issues.pageInfo.hasNextPage) break;
    cursor = d.issues.pageInfo.endCursor;
  }
  return rows;
}
