import { cookies } from "next/headers";
import { getPool } from "../../../../../db/pool.js";
import { validateAdminSession } from "../../../../../lib/auth.js";
import { loadMember, loadMemberRollups } from "../../../../../lib/queries.js";
import { MemberProfile } from "../../../../../components/member-profile.js";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("fleetlens_session")?.value;
  if (!cookieToken) return <div>Unauthorized.</div>;

  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return <div>Session expired.</div>;

  const member = await loadMember(id, pool);
  if (!member) return <div>Member not found.</div>;

  const rollups = await loadMemberRollups(member.team_id, id, 30, pool);

  return (
    <div>
      <a href={`/team/${slug}`} style={{ color: "#6b7280", fontSize: 14, textDecoration: "none" }}>
        ← Back to Roster
      </a>
      <MemberProfile member={member} rollups={rollups} />
    </div>
  );
}
