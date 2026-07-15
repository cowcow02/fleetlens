import { getPool } from "../../db/pool";
import { instanceState } from "../../lib/server-config";
import { lookupInvite } from "../../lib/members";
import { SignupForm } from "../../components/signup-form";
import { FleetlensBrand } from "../../components/fleetlens-brand";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const state = await instanceState();
  const sp = await searchParams;
  const inviteToken = sp.invite?.trim() || "";

  let invite: { email: string | null; teamName: string | null } | null = null;
  if (inviteToken) {
    const row = await lookupInvite(inviteToken, getPool());
    if (row) {
      const teamRes = await getPool().query("SELECT name FROM teams WHERE id = $1", [row.team_id]);
      invite = { email: row.email, teamName: teamRes.rows[0]?.name ?? null };
    }
  }

  const isFirstUser = !state.hasAnyUser;
  const publicSignupEnabled = state.allowPublicSignup;
  const canSignUp = isFirstUser || !!invite || publicSignupEnabled;

  return (
    <>
      <header className="masthead">
        <FleetlensBrand />
        <div className="masthead-meta">
          {isFirstUser ? (
            <>
              <span className="mono">INSTALL</span>
              <span className="dot">·</span>
              <span className="mono">FIRST USER</span>
            </>
          ) : invite ? (
            <>
              <span className="mono">INVITED</span>
              <span className="dot">·</span>
              <span className="mono">{invite.teamName?.toUpperCase()}</span>
            </>
          ) : (
            <>
              <span className="mono">SIGN UP</span>
            </>
          )}
        </div>
      </header>
      <SignupForm
        isFirstUser={isFirstUser}
        inviteToken={inviteToken || null}
        inviteEmail={invite?.email ?? null}
        inviteTeamName={invite?.teamName ?? null}
        canSignUp={canSignUp}
      />
    </>
  );
}
