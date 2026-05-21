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

// Throws on the first malformed entry so route handlers can return 400.
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
  // cardinality(...) > 0 skips the SELECT when the team has no allowlist
  // configured (the common case) so signup / join stay on the auth hot path
  // without a wasted round-trip.
  const res = await pool.query<{ allowed_signup_domains: string[] }>(
    "SELECT allowed_signup_domains FROM teams WHERE id = $1 AND cardinality(allowed_signup_domains) > 0",
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

// Single gate for every redemption path (signup new user, signup existing
// user, /api/team/join authenticated user). Returns null if the email is
// allowed, or the generic user-facing error message if not. The message
// deliberately doesn't echo the configured domains.
export async function denySignupForTeamDomain(
  teamId: string,
  email: string,
  pool: pg.Pool,
): Promise<string | null> {
  const domains = await getAllowedSignupDomains(teamId, pool);
  if (domains.length === 0) return null;
  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (emailDomain && domains.includes(emailDomain)) return null;
  return "Sign-up is restricted for this team. Contact a team admin if you believe this is an error.";
}
