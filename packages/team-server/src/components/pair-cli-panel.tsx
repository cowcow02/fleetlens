"use client";

import { useState } from "react";

// Self-service pairing UI shown on the user's own profile. Mints a fresh
// device token via /api/team/device-token, then shows the exact
// `fleetlens team join` command — copy-able. Old tokens are revoked
// when a new one's minted, so a forgotten paired machine stops syncing
// the moment the user does this.
export function PairCliPanel({ teamSlug }: { teamSlug: string }) {
  const [state, setState] = useState<"idle" | "minting" | "ready" | "error">("idle");
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function mint() {
    setState("minting");
    setError(null);
    try {
      const res = await fetch("/api/team/device-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${res.status}`);
        setState("error");
        return;
      }
      const data = (await res.json()) as { bearerToken: string; serverUrl: string };
      setToken(data.bearerToken);
      setServerUrl(data.serverUrl);
      setState("ready");
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }

  async function copy() {
    if (!token || !serverUrl) return;
    const command = `fleetlens team join ${serverUrl} ${token}`;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore — user can copy manually */
    }
  }

  return (
    <section className="settings-section" style={{ marginTop: 24 }}>
      <div className="subsection-head">
        <h2>Pair your CLI</h2>
        <span className="kicker">
          mints a fresh device token for this seat — old tokens stop working
        </span>
      </div>
      <div
        style={{
          padding: "16px 18px",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
        }}
      >
        {state === "idle" && (
          <>
            <p style={{ fontSize: 13, color: "var(--ink)", margin: 0 }}>
              Pair your local fleetlens CLI with this team so your daemon
              syncs usage data here. Click the button to generate a one-time
              device token; you&rsquo;ll then run a short command on your
              machine.
            </p>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--mute)" }}>
              First time?{" "}
              <code className="mono">npm install -g fleetlens</code>, then
              click below.
            </div>
            <button
              type="button"
              onClick={mint}
              style={{
                marginTop: 14,
                padding: "8px 16px",
                background: "var(--ink)",
                color: "var(--paper)",
                border: "none",
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              Generate device token
            </button>
          </>
        )}

        {state === "minting" && (
          <div style={{ fontSize: 13, color: "var(--mute)" }}>Generating…</div>
        )}

        {state === "error" && (
          <>
            <div style={{ fontSize: 13, color: "#a93b2c" }}>
              Failed to mint a token: {error ?? "unknown error"}
            </div>
            <button
              type="button"
              onClick={mint}
              style={{
                marginTop: 12,
                padding: "6px 12px",
                background: "transparent",
                color: "var(--ink)",
                border: "1px solid var(--rule)",
                borderRadius: 4,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </>
        )}

        {state === "ready" && token && serverUrl && (
          <>
            <p style={{ fontSize: 13, color: "var(--ink)", margin: 0 }}>
              Run this on the machine where you&rsquo;ve installed{" "}
              <code className="mono">fleetlens</code>. The token is shown
              once — copy it now.
            </p>
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                background: "var(--ink)",
                color: "var(--paper)",
                border: "1px solid var(--ink)",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                wordBreak: "break-all",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                fleetlens team join {serverUrl} {token}
              </span>
              <button
                type="button"
                onClick={copy}
                style={{
                  padding: "6px 12px",
                  background: copied ? "#2c6e49" : "var(--paper)",
                  color: copied ? "var(--paper)" : "var(--ink)",
                  border: "none",
                  borderRadius: 3,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--mute)" }}>
              Your browser will open to finish setup — choose which projects
              to share, then start syncing.
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--mute)" }}>
              Generating a new token revokes the previous one — any other
              machine paired with this seat will stop syncing until you
              re-pair it.
            </div>
            <button
              type="button"
              onClick={() => {
                setState("idle");
                setToken(null);
                setServerUrl(null);
                setCopied(false);
              }}
              style={{
                marginTop: 12,
                padding: "5px 10px",
                background: "transparent",
                color: "var(--mute)",
                border: "1px solid var(--rule)",
                borderRadius: 3,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </>
        )}
      </div>
    </section>
  );
}
