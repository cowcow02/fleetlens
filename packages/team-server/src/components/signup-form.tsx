"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  isFirstUser: boolean;
  inviteToken: string | null;
  inviteEmail: string | null;
  inviteTeamName: string | null;
  canSignUp: boolean;
};

export function SignupForm({ isFirstUser, inviteToken, inviteEmail, inviteTeamName, canSignUp }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(inviteEmail ?? "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceToken, setDeviceToken] = useState<{ token: string; slug: string } | null>(null);

  if (deviceToken) {
    const serverUrl = typeof window !== "undefined" ? window.location.origin : "";
    const cmd = `fleetlens team join ${serverUrl} ${deviceToken.token}`;
    return (
      <div className="form-card">
        <h1>You&rsquo;re <em>in</em></h1>
        <p className="lede">
          Welcome. Next — pair your local daemon so your metrics flow to the dashboard. Run this in your terminal:
        </p>
        <code className="help-example" style={{ userSelect: "all", padding: 16, fontSize: 13 }}>{cmd}</code>
        <p className="lede" style={{ fontSize: 13, color: "var(--mute)" }}>
          Your browser will open to finish setup — choose which projects to share, then start syncing.
        </p>
        <p className="lede" style={{ fontSize: 13, color: "var(--mute)" }}>
          This device token is shown <strong>once</strong>. Copy the whole command above; you can always regenerate a token later in Settings.
        </p>
        <button
          className="btn"
          style={{ width: "100%" }}
          onClick={() => router.push(`/team/${deviceToken.slug}`)}
        >
          Continue to dashboard →
        </button>
      </div>
    );
  }

  if (!canSignUp) {
    return (
      <div className="form-card">
        <h1>Signup <em>closed</em></h1>
        <p className="lede">
          This Fleetlens is invite-only. Ask your admin for an invite link, then revisit this page with it.
        </p>
        <a href="/login" className="btn" style={{ width: "100%", textAlign: "center" }}>
          Sign in instead →
        </a>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          displayName: displayName.trim() || undefined,
          teamName: isFirstUser ? teamName : undefined,
          inviteToken: inviteToken || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        setError(data.error || "Signup failed");
        return;
      }
      const data = await res.json();
      if (data.deviceToken && data.landingSlug) {
        setDeviceToken({ token: data.deviceToken, slug: data.landingSlug });
      } else if (data.landingSlug) {
        router.push(`/team/${data.landingSlug}`);
      } else {
        router.push("/");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const title = isFirstUser ? <>Set up your <em>Fleetlens</em></> : inviteToken ? <>Join <em>{inviteTeamName}</em></> : <>Create your <em>account</em></>;
  const lede = isFirstUser
    ? "This is the first account on this install — you'll become the admin. Name your team below and create your password."
    : inviteToken
    ? `You've been invited to join ${inviteTeamName}. Create your account to accept.`
    : "Create your account to continue.";

  return (
    <div className="form-card">
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            required
            autoFocus={!inviteEmail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@acme.com"
            disabled={!!inviteEmail}
          />
        </div>
        <div className="form-group">
          <label>Password <span className="optional">— at least 8 characters</span></label>
          <input
            type="password"
            required
            minLength={8}
            autoFocus={!!inviteEmail}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="form-group">
          <label>Your name <span className="optional">— optional</span></label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alice Wong"
          />
        </div>
        {isFirstUser && (
          <div className="form-group">
            <label>Team name</label>
            <input
              type="text"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Acme Engineering"
            />
          </div>
        )}
        <button type="submit" disabled={loading} className="btn" style={{ width: "100%", marginTop: 16 }}>
          {loading ? (isFirstUser ? "Creating team…" : "Creating account…") : (isFirstUser ? "Create team & account →" : inviteToken ? "Join team →" : "Create account →")}
        </button>
      </form>
      {!isFirstUser && (
        <div className="form-alt">
          Already have an account? <a href="/login">Sign in</a>
        </div>
      )}
    </div>
  );
}
