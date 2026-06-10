import semver from "semver";

const GHCR_REPO = "cowcow02/fleetlens-team-server";
const GHCR_TAGS_URL = `https://ghcr.io/v2/${GHCR_REPO}/tags/list`;
const GHCR_TOKEN_URL = `https://ghcr.io/token?scope=repository:${GHCR_REPO}:pull`;

// GHCR requires a Bearer token even on public images' registry API. Fetch an
// anonymous token first, then use it for the tags-list call.
async function getAnonToken(): Promise<string> {
  const res = await fetch(GHCR_TOKEN_URL, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`GHCR token endpoint returned ${res.status}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("GHCR token endpoint returned no token");
  return data.token;
}

// GHCR pages tags/list at 100 in creation order with an RFC-5988 Link header,
// so the newest release tag is always on the LAST page — reading only the
// first page froze "latest" at whatever fit there (per-push sha tags fill the
// pages fast). Follow the chain; the page cap is a guard against a registry
// hiccup looping forever.
function nextLink(header: string | null, base: string): string | null {
  const m = header?.match(/<([^>]+)>\s*;\s*rel="next"/);
  return m ? new URL(m[1], base).toString() : null;
}

export async function getLatestVersion(): Promise<string | null> {
  const token = await getAnonToken();
  const tags: string[] = [];
  let url: string | null = GHCR_TAGS_URL;
  for (let page = 0; url && page < 50; page++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`GHCR tags list returned ${res.status}`);
    const data = (await res.json()) as { tags?: string[] };
    tags.push(...(data.tags ?? []));
    url = nextLink(res.headers.get("link"), url);
  }
  const semverTags = tags.filter((t) => semver.valid(t) !== null);
  if (semverTags.length === 0) return null;
  return semverTags.sort(semver.rcompare)[0];
}
