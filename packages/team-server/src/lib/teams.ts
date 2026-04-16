import type pg from "pg";
import { generateToken, sha256 } from "./crypto.js";
import { ClaimPayload } from "./zod-schemas.js";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function claimTeam(raw: unknown, bootstrapHash: string, bootstrapExpiresAt: Date, pool: pg.Pool) {
  const payload = ClaimPayload.parse(raw);

  if (new Date() > bootstrapExpiresAt) throw new Error("Bootstrap token expired");
  if (sha256(payload.bootstrapToken) !== bootstrapHash) throw new Error("Invalid bootstrap token");

  const existing = await pool.query("SELECT 1 FROM teams LIMIT 1");
  if (existing.rowCount && existing.rowCount > 0) throw new Error("Team already claimed");

  let slug = slugify(payload.teamName);
  const collision = await pool.query("SELECT 1 FROM teams WHERE slug = $1", [slug]);
  if (collision.rowCount && collision.rowCount > 0) {
    slug += "-" + generateToken(2);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const teamRes = await client.query(
      "INSERT INTO teams (slug, name) VALUES ($1, $2) RETURNING id, slug, name",
      [slug, payload.teamName]
    );
    const team = teamRes.rows[0];

    const bearerToken = generateToken(32);
    const memberRes = await client.query(
      `INSERT INTO members (team_id, email, display_name, role, bearer_token_hash)
       VALUES ($1, $2, $3, 'admin', $4) RETURNING id, email, display_name, role`,
      [team.id, payload.adminEmail || null, payload.adminDisplayName || null, sha256(bearerToken)]
    );
    const admin = memberRes.rows[0];

    const sessionToken = generateToken(32);
    await client.query(
      "INSERT INTO admin_sessions (member_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [admin.id, sha256(sessionToken), new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)]
    );

    const recoveryToken = "rt_" + generateToken(32);
    await client.query(
      "INSERT INTO admin_sessions (member_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [admin.id, sha256(recoveryToken), new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)]
    );

    await client.query(
      "INSERT INTO events (team_id, member_id, action) VALUES ($1, $2, 'admin.claim')",
      [team.id, admin.id]
    );

    await client.query("COMMIT");

    return { team, admin, sessionToken, recoveryToken };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
