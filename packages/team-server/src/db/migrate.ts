import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "./pool.js";
import { generateBootstrapToken } from "../lib/auth.js";
import { setBootstrapState, bootstrapState } from "../lib/bootstrap-state.js";

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(join(import.meta.dirname, "schema.sql"), "utf8");
  await getPool().query(sql);

  const teams = await getPool().query("SELECT 1 FROM teams LIMIT 1");
  if (teams.rowCount === 0 && !bootstrapState) {
    const { token, hash, expiresAt } = generateBootstrapToken();
    setBootstrapState({ hash, expiresAt });
    console.log(`fleetlens-server: bootstrap token = ${token} (valid for 15 minutes)`);
    console.log(`fleetlens-server: to claim this instance, open the server URL and paste the token`);
  }
}
