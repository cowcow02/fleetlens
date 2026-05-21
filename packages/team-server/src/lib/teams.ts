import type pg from "pg";
import { generateToken, sha256 } from "./crypto";

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
}

export async function uniqueSlug(base: string, pool: pg.Pool): Promise<string> {
  let slug = slugify(base);
  const collision = await pool.query("SELECT 1 FROM teams WHERE slug = $1", [slug]);
  if (collision.rowCount) slug = `${slug}-${generateToken(2)}`;
  return slug;
}

export async function createTeamWithAdmin(
  teamName: string,
  userAccountId: string,
  pool: pg.Pool,
): Promise<{ team: { id: string; slug: string; name: string }; membership: { id: string; bearerToken: string } }> {
  const slug = await uniqueSlug(teamName, pool);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const teamRes = await client.query(
      "INSERT INTO teams (slug, name) VALUES ($1, $2) RETURNING id, slug, name",
      [slug, teamName]
    );
    const team = teamRes.rows[0];

    const bearerToken = "bt_" + generateToken(32);
    const membershipRes = await client.query(
      `INSERT INTO memberships (user_account_id, team_id, role, bearer_token_hash)
       VALUES ($1, $2, 'admin', $3) RETURNING id`,
      [userAccountId, team.id, sha256(bearerToken)]
    );

    await client.query(
      "INSERT INTO events (team_id, actor_id, action) VALUES ($1, $2, 'team.create')",
      [team.id, userAccountId]
    );
    await client.query("COMMIT");
    return { team, membership: { id: membershipRes.rows[0].id, bearerToken } };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

// Normalise + validate a comma-separated user input into a sorted, deduplicated
// list of lowercase domains. Strips leading `@` and surrounding whitespace.
// Throws when any entry is malformed so route handlers can return 400.
export function parseAllowedDomains(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(",");
  const cleaned: string[] = [];
  for (const item of raw) {
    const v = item.trim().replace(/^@/, "").toLowerCase();
    if (!v) continue;
    if (!DOMAIN_RE.test(v)) throw new Error(`Invalid domain: ${v}`);
    if (!cleaned.includes(v)) cleaned.push(v);
  }
  cleaned.sort();
  return cleaned;
}

export async function getAllowedSignupDomains(
  teamId: string,
  pool: pg.Pool,
): Promise<string[]> {
  const res = await pool.query<{ allowed_signup_domains: string[] }>(
    "SELECT allowed_signup_domains FROM teams WHERE id = $1",
    [teamId],
  );
  return res.rowCount ? res.rows[0].allowed_signup_domains : [];
}

export async function setAllowedSignupDomains(
  teamId: string,
  domains: string[],
  pool: pg.Pool,
): Promise<void> {
  await pool.query(
    "UPDATE teams SET allowed_signup_domains = $1 WHERE id = $2",
    [domains, teamId],
  );
}
