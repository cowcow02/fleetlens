import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { listStaff } from "../../../lib/staff";
import { StaffTable } from "../../../components/staff-table";

export default async function StaffPage() {
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const users = await listStaff(pool);
  const staffCount = users.filter((u) => u.is_staff).length;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Staff <em>Access</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            {staffCount} staff · {users.length} total user{users.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="kicker">Staff only</div>
      </div>

      {staffCount === 1 && (
        <section
          style={{
            marginBottom: 24,
            padding: "12px 16px",
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            borderLeft: "3px solid var(--danger)",
          }}
        >
          <strong>Only one staff user.</strong>{" "}
          Consider promoting another user so you&rsquo;re not locked out if this account is lost.
        </section>
      )}

      <section>
        <StaffTable
          users={users.map((u) => ({
            id: u.id,
            email: u.email,
            display_name: u.display_name,
            is_staff: u.is_staff,
            created_at: u.created_at instanceof Date ? u.created_at.toISOString() : String(u.created_at),
          }))}
          currentUserId={session.user.id}
        />
      </section>

      <footer className="page-footer">
        <span>Fleetlens · Team Edition</span>
        <span>{new Date().toISOString()}</span>
      </footer>
    </>
  );
}
