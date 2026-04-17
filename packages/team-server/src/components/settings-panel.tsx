"use client";

import { useState } from "react";

type TeamRow = { id: string; name: string; slug: string; created_at: string };
type MemberRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  revoked_at: string | null;
};

export function SettingsPanel({ team, members }: { team: TeamRow; members: MemberRow[] }) {
  const [teamName, setTeamName] = useState(team.name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function saveProfile() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/team/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: teamName }),
    });
    setSaving(false);
    if (res.ok) setMessage("Saved");
    else setMessage("Failed to save");
  }

  async function revokeMember(memberId: string) {
    if (!confirm("Revoke this member? They will lose access immediately.")) return;
    await fetch(`/api/team/members/${memberId}`, { method: "DELETE" });
    window.location.reload();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Team Profile */}
      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Team Profile</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={teamName} onChange={e => setTeamName(e.target.value)}
                 style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 4, width: 300 }} />
          <button onClick={saveProfile} disabled={saving}
                  style={{ padding: "8px 16px", borderRadius: 4, border: "1px solid #d1d5db", cursor: "pointer" }}>
            {saving ? "Saving..." : "Save"}
          </button>
          {message && <span style={{ color: "#6b7280", fontSize: 14 }}>{message}</span>}
        </div>
        <div style={{ color: "#6b7280", fontSize: 13, marginTop: 8 }}>
          Slug: {team.slug} · Created: {new Date(team.created_at).toLocaleDateString()}
        </div>
      </section>

      {/* Members */}
      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Members</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
              <th style={{ textAlign: "left", padding: 8 }}>Name</th>
              <th style={{ textAlign: "left", padding: 8 }}>Email</th>
              <th style={{ textAlign: "left", padding: 8 }}>Role</th>
              <th style={{ textAlign: "left", padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: 8 }}>{m.display_name || "—"}</td>
                <td style={{ padding: 8, color: "#6b7280" }}>{m.email || "—"}</td>
                <td style={{ padding: 8 }}>{m.role}</td>
                <td style={{ padding: 8 }}>
                  {m.revoked_at ? (
                    <span style={{ color: "#ef4444" }}>Revoked</span>
                  ) : (
                    <span style={{ color: "#22c55e" }}>Active</span>
                  )}
                </td>
                <td style={{ padding: 8 }}>
                  {!m.revoked_at && m.role !== "admin" && (
                    <button onClick={() => revokeMember(m.id)}
                            style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
