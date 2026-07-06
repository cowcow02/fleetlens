"use client";

import { useState } from "react";

// Admin-only overflow menu for a member. Lives in the header's top-right as a
// kebab (⋯) so per-member admin actions don't need their own section. Today it
// holds one action (30-day backfill); new admin actions slot in as menu items.
type Status = "idle" | "submitting" | "success" | "already-queued" | "error";

export function MemberAdminMenu({
  membershipId,
  slug,
}: {
  membershipId: string;
  slug: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async () => {
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/admin/members/${membershipId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "backfill-activity", params: { days: 30 } }),
      });
      // 201 = newly enqueued; 200 = idempotency hit (identical pending command
      // already exists). Both are success from the admin's POV; surface them
      // distinctly so they don't wait for two runs.
      if (res.status === 201) {
        setStatus("success");
      } else if (res.status === 200) {
        setStatus("already-queued");
      } else {
        const body = await res.json().catch(() => null);
        setStatus("error");
        setErrorMessage(body?.error ?? `Request failed (${res.status})`);
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage((err as Error).message);
    }
    setConfirmOpen(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Member actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        style={{
          border: "1px solid var(--rule)",
          background: "var(--paper)",
          color: "var(--mute)",
          cursor: "pointer",
          width: 30,
          height: 30,
          lineHeight: "1",
          fontSize: 18,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ⋯
      </button>

      {menuOpen && (
        <>
          {/* Click-away backdrop — closes the menu without a document listener. */}
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            role="menu"
            style={{
              position: "absolute",
              top: 36,
              right: 0,
              minWidth: 220,
              background: "var(--paper)",
              border: "1px solid var(--ink)",
              boxShadow: "6px 6px 0 var(--ink)",
              zIndex: 41,
              padding: 4,
            }}
          >
            <a
              role="menuitem"
              href={`/team/${slug}/members/${membershipId}/logs`}
              onClick={() => setMenuOpen(false)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                textDecoration: "none",
                cursor: "pointer",
                padding: "9px 12px",
                fontSize: 12,
                color: "var(--ink)",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              View logs
            </a>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "9px 12px",
                fontSize: 12,
                color: "var(--ink)",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              Request 30-day backfill
            </button>
          </div>
        </>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setConfirmOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "color-mix(in srgb, var(--ink) 55%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--paper)",
              border: "1px solid var(--ink)",
              boxShadow: "12px 12px 0 var(--ink)",
              maxWidth: 520,
              width: "100%",
              padding: "32px 36px",
            }}
          >
            <h3
              style={{
                fontFamily: '"Instrument Serif", serif',
                fontSize: 26,
                lineHeight: 1.1,
                margin: "0 0 12px",
              }}
            >
              Queue 30-day activity backfill?
            </h3>
            <p style={{ color: "var(--mute)", fontSize: 13, lineHeight: 1.5, margin: "0 0 22px" }}>
              The member&apos;s daemon will pick this up on its next sync (within 5 minutes) and
              re-push their last 30 days of daily activity. Already-recorded days are upserted,
              not duplicated.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setConfirmOpen(false)}
                style={{ fontSize: 12 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={submit}
                disabled={status === "submitting"}
                style={{ fontSize: 12 }}
              >
                {status === "submitting" ? "Queuing…" : "Queue command"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result toast — anchored under the kebab, right-aligned. */}
      {(status === "success" || status === "already-queued" || status === "error") && (
        <div
          style={{
            position: "absolute",
            top: 36,
            right: 0,
            minWidth: 240,
            maxWidth: 320,
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            padding: "10px 12px",
            zIndex: 41,
          }}
        >
          <p
            className="kicker"
            style={{
              margin: 0,
              color:
                status === "success"
                  ? "#2c6e49"
                  : status === "error"
                    ? "#a93b2c"
                    : "var(--mute)",
            }}
          >
            {status === "success" &&
              "Command queued — will execute on member's next sync (within 5 min)."}
            {status === "already-queued" &&
              "A backfill is already queued; it will execute on their next sync."}
            {status === "error" && (errorMessage ?? "Failed to queue command.")}
          </p>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            style={{
              marginTop: 6,
              background: "transparent",
              border: "none",
              color: "var(--mute)",
              cursor: "pointer",
              fontSize: 11,
              padding: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
