import type pg from "pg";

export type PendingCommand = {
  id: string;
  type: string;
  params: Record<string, unknown>;
};

export type IncomingResult = {
  id: string;
  ok: boolean;
  completedAt: string;
  summary?: Record<string, unknown>;
  error?: string;
};

// Capped per response so a runaway "admin queued 500 commands" doesn't bloat
// every ingest. Excess wait for the next sync.
const MAX_COMMANDS_PER_RESPONSE = 10;

export async function processCommandResults(
  pool: pg.Pool,
  membershipId: string,
  results: IncomingResult[],
): Promise<void> {
  if (results.length === 0) return;
  for (const r of results) {
    await pool.query(
      `UPDATE member_commands
         SET completed_at = $1, result = $2
       WHERE id = $3 AND membership_id = $4 AND completed_at IS NULL`,
      [r.completedAt, { ok: r.ok, summary: r.summary, error: r.error }, r.id, membershipId],
    );
  }
}

export async function fetchPendingCommands(
  pool: pg.Pool,
  membershipId: string,
): Promise<PendingCommand[]> {
  const res = await pool.query<{ id: string; command_type: string; params: Record<string, unknown> }>(
    `UPDATE member_commands
       SET delivered_at = COALESCE(delivered_at, now())
     WHERE id IN (
       SELECT id FROM member_commands
       WHERE membership_id = $1 AND completed_at IS NULL
       ORDER BY issued_at
       LIMIT $2
     )
     RETURNING id, command_type, params`,
    [membershipId, MAX_COMMANDS_PER_RESPONSE],
  );
  return res.rows.map((row) => ({
    id: row.id,
    type: row.command_type,
    params: row.params,
  }));
}
