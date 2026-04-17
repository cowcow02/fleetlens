import { redirect } from "next/navigation";
import { getPool } from "../db/pool.js";
import { ClaimForm } from "../components/claim-form.js";

export default async function RootPage() {
  const teams = await getPool().query("SELECT slug FROM teams LIMIT 1");
  if (teams.rowCount && teams.rowCount > 0) {
    redirect(`/team/${teams.rows[0].slug}`);
  }

  return (
    <div style={{ maxWidth: 480, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>Fleetlens</h1>
      <p>Claim this instance to set up your team.</p>
      <ClaimForm />
    </div>
  );
}
