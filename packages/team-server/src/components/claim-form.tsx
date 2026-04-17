"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RecoveryTokenModal } from "./recovery-token-modal.js";

export function ClaimForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recovery, setRecovery] = useState<{ token: string; slug: string } | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/team/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bootstrapToken: form.get("bootstrapToken"),
          teamName: form.get("teamName"),
          adminEmail: form.get("adminEmail") || undefined,
          adminDisplayName: form.get("adminDisplayName") || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        setError(data.error || "Claim failed");
        return;
      }

      const data = await res.json();
      setRecovery({ token: data.recoveryToken, slug: data.team.slug });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (recovery) {
    return (
      <RecoveryTokenModal
        recoveryToken={recovery.token}
        onDismiss={() => router.push(`/team/${recovery.slug}`)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <div style={{ color: "red", padding: 8, border: "1px solid red", borderRadius: 4 }}>{error}</div>}
      <label>
        Bootstrap Token
        <input name="bootstrapToken" type="text" required placeholder="xxxx-xxxx-xxxx-xxxx"
               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
      </label>
      <label>
        Team Name
        <input name="teamName" type="text" required placeholder="Acme Engineering"
               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
      </label>
      <label>
        Admin Email (optional)
        <input name="adminEmail" type="email" placeholder="cto@acme.com"
               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
      </label>
      <label>
        Display Name (optional)
        <input name="adminDisplayName" type="text" placeholder="Alice Wong"
               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
      </label>
      <button type="submit" disabled={loading} style={{ padding: "10px 20px", marginTop: 8 }}>
        {loading ? "Claiming..." : "Claim as Admin"}
      </button>
    </form>
  );
}
