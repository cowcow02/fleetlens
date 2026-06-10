// GitHub REST + GraphQL client for the team integration. Token is a pasted
// fine-grained PAT / OAuth token with read access to the configured repos.
// Detection of AI assistance is trailer-based (Co-Authored-By / generated-with
// markers) — an undercount when squash-merges strip trailers; the precise
// session↔commit-SHA join is the planned upgrade.

const API = "https://api.github.com";

// Agent identities seen in co-author trailers or bot author logins. Matched
// against the co-author NAME/EMAIL portion only, never prose, to avoid
// flagging commits that merely talk about these tools.
const AI_COAUTHOR_RE =
  /^co-authored-by:.*\b(claude|copilot|cursor|codex|gemini|devin|aider|openhands|sweep)\b/im;
const AI_MARKER_RE =
  /generated with \[?(claude code|codex|cursor|copilot|gemini)|🤖 generated with/i;

export function isAiCommitMessage(message: string): boolean {
  return AI_COAUTHOR_RE.test(message) || AI_MARKER_RE.test(message);
}

/** Median of millisecond durations, in hours (1 decimal). Null when empty. */
export function medianHours(ms: number[]): number | null {
  if (ms.length === 0) return null;
  const s = [...ms].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round((m / 3_600_000) * 10) / 10;
}

export type PullNode = {
  number: number;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
  additions: number;
  deletions: number;
  author: { login: string } | null;
  commits: { totalCount: number; nodes: { commit: { message: string; authoredDate: string } }[] };
  reviews: { nodes: { submittedAt: string }[] };
};

export type PullRow = {
  number: number;
  title: string;
  authorLogin: string | null;
  state: "open" | "merged" | "closed";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  firstCommitAt: string | null;
  firstReviewAt: string | null;
  additions: number;
  deletions: number;
  commitsTotal: number;
  commitsAi: number;
  aiAssisted: boolean;
};

export function toPullRow(n: PullNode): PullRow {
  const commitDates = n.commits.nodes.map((c) => c.commit.authoredDate).sort();
  const commitsAi = n.commits.nodes.filter((c) => isAiCommitMessage(c.commit.message)).length;
  return {
    number: n.number,
    title: n.title,
    authorLogin: n.author?.login ?? null,
    state: n.state === "MERGED" ? "merged" : n.state === "OPEN" ? "open" : "closed",
    createdAt: n.createdAt,
    mergedAt: n.mergedAt,
    closedAt: n.closedAt,
    firstCommitAt: commitDates[0] ?? null,
    firstReviewAt: n.reviews.nodes[0]?.submittedAt ?? null,
    additions: n.additions,
    deletions: n.deletions,
    commitsTotal: n.commits.totalCount,
    commitsAi,
    aiAssisted: commitsAi > 0,
  };
}

async function gh(token: string, path: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

export async function validateGithubToken(token: string): Promise<{ login: string }> {
  const res = await gh(token, "/user");
  if (!res.ok) throw new Error(`GitHub rejected the token (HTTP ${res.status})`);
  const body = (await res.json()) as { login: string };
  return { login: body.login };
}

/** Throws naming the first repo the token cannot see. */
export async function assertRepoAccess(token: string, repos: string[]): Promise<void> {
  for (const repo of repos) {
    const res = await gh(token, `/repos/${repo}`);
    if (!res.ok) throw new Error(`Token cannot access ${repo} (HTTP ${res.status})`);
  }
}

const PULLS_QUERY = `
query ($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state createdAt mergedAt closedAt updatedAt additions deletions
        author { login }
        commits(first: 100) { totalCount nodes { commit { message authoredDate } } }
        reviews(first: 1) { nodes { submittedAt } }
      }
    }
  }
}`;

/** PRs updated within the trailing `sinceDays`, newest first. ~1 call / 50 PRs. */
export async function fetchRepoPulls(
  token: string,
  repo: string,
  sinceDays: number,
): Promise<PullRow[]> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Repo must be "owner/name", got "${repo}"`);
  const since = Date.now() - sinceDays * 86_400_000;

  const rows: PullRow[] = [];
  let cursor: string | null = null;
  // Page cap is a runaway guard; 20 pages × 50 PRs ≫ any realistic sync window.
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: PULLS_QUERY, variables: { owner, name, cursor } }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL error for ${repo} (HTTP ${res.status})`);
    const body = (await res.json()) as {
      errors?: { message: string }[];
      data?: { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: PullNode[] } } | null };
    };
    if (body.errors?.length) throw new Error(`GitHub GraphQL error for ${repo}: ${body.errors[0].message}`);
    if (!body.data?.repository) throw new Error(`Repository ${repo} not found or not accessible`);

    const conn = body.data.repository.pullRequests;
    let pastWindow = false;
    for (const node of conn.nodes) {
      if (new Date(node.updatedAt).getTime() < since) {
        pastWindow = true;
        break;
      }
      rows.push(toPullRow(node));
    }
    if (pastWindow || !conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return rows;
}
