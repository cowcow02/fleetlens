"use client";
import { useState } from "react";

export function ManagerInviteForm({
  teamSlug,
  groupSlug,
  availableGroups,
  preselectedGroupId,
}: {
  teamSlug: string;
  groupSlug: string;
  availableGroups: { id: string; slug: string; name: string }[];
  preselectedGroupId: string;
}) {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>([preselectedGroupId]);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (selected.length === 0) {
      setError("Pick at least one group");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/team/${teamSlug}/groups/${groupSlug}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() || undefined, groupIds: selected }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      const { joinUrl, tokenPlaintext } = await r.json();
      setLink(joinUrl ?? `${window.location.origin}/signup?invite=${tokenPlaintext}`);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  return (
    <section className="settings-section">
      <p className="kicker" style={{ marginBottom: 16 }}>
        Generates a share link. The invitee joins as a regular team member and is added to the groups you select.
      </p>

      <div className="form-group" style={{ maxWidth: 520, marginBottom: 16 }}>
        <label htmlFor="invite-email">Email · optional</label>
        <input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="newhire@example.com"
        />
      </div>

      <fieldset
        style={{
          border: "1px solid var(--rule)",
          padding: "10px 12px",
          margin: "0 0 16px 0",
          maxWidth: 520,
        }}
      >
        <legend
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--mute)", padding: "0 6px" }}
        >
          PLACE IN GROUPS
        </legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {availableGroups.map((g) => (
            <label
              key={g.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                opacity: g.id === preselectedGroupId ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(g.id)}
                disabled={g.id === preselectedGroupId}
                onChange={() => toggle(g.id)}
              />
              {g.name}
              {g.id === preselectedGroupId && (
                <span className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--mute)" }}>
                  · LOCKED
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <button onClick={submit} disabled={busy} className="btn">
        {busy ? "Generating…" : "+ Generate invite link"}
      </button>

      {error && (
        <div className="form-error" style={{ marginTop: 16, maxWidth: 520 }}>
          {error}
        </div>
      )}

      {link && (
        <div className="help-box" style={{ marginTop: 16, maxWidth: 520 }}>
          <p>Invite link created. Copy it and share out-of-band:</p>
          <code className="help-example">{link}</code>
          <p className="help-note">Expires in 7 days. The invitee creates their password on first click.</p>
        </div>
      )}
    </section>
  );
}
