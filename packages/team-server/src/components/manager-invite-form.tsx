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
        body: JSON.stringify({ email: email || undefined, groupIds: selected }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      const { token } = await r.json();
      setLink(`${window.location.origin}/signup?invite=${token}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p style={{ opacity: 0.7 }}>
        Generates an invite link. The new member will join as a regular team member and be added to the groups you select below.
      </p>
      <label>
        Email (optional, for the invite record):{" "}
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <fieldset>
        <legend>Groups to add the new member to</legend>
        {availableGroups.map((g) => (
          <label key={g.id} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={selected.includes(g.id)}
              disabled={g.id === preselectedGroupId}
              onChange={(e) =>
                setSelected((cur) =>
                  e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id),
                )
              }
            />{" "}
            {g.name}
          </label>
        ))}
      </fieldset>
      <button onClick={submit} disabled={busy}>Generate invite link</button>
      {error && <div style={{ color: "tomato", marginTop: 8 }}>{error}</div>}
      {link && (
        <div style={{ marginTop: 12 }}>
          <strong>Share this link:</strong>
          <input readOnly value={link} style={{ width: "100%" }} onClick={(e) => e.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}
