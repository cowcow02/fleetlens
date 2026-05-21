"use client";

import { useState } from "react";

// Five visible states: idle, submitting (button label flips), success (201),
// already-queued (200 — idempotency hit), error. The modal is the gate so a
// stray click can't enqueue a no-undo command.
type Status = "idle" | "submitting" | "success" | "already-queued" | "error";

export function RequestBackfillButton({ membershipId }: { membershipId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const submit = async () => {
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/admin/members/${membershipId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "backfill-activity", params: { days: 30 } }),
      });
      // 201 = newly enqueued; 200 = idempotency hit (an identical pending
      // command already exists). Both are "success" from the user's POV but
      // we surface them distinctly so admins know not to wait for two runs.
      if (res.status === 201) {
        setStatus("success");
      } else if (res.status === 200) {
        setStatus("already-queued");
      } else {
        const body = await res.json().catch(() => null);
        setStatus("error");
        setErrorMessage(body?.error ?? `Request failed (${res.status})`);
      }
      setOpen(false);
    } catch (err) {
      setStatus("error");
      setErrorMessage((err as Error).message);
      setOpen(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        className="btn secondary"
        onClick={() => setOpen(true)}
        disabled={status === "submitting"}
        style={{ fontSize: 12 }}
      >
        Request 30-day backfill
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
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
                onClick={() => setOpen(false)}
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

      {status === "success" && (
        <p className="kicker" style={{ marginTop: 10, color: "#2c6e49" }}>
          Command queued — will execute on member&apos;s next sync (within 5 min).
        </p>
      )}
      {status === "already-queued" && (
        <p className="kicker" style={{ marginTop: 10, color: "var(--mute)" }}>
          A backfill is already queued for this member; it will execute on their next sync.
        </p>
      )}
      {status === "error" && (
        <p className="kicker" style={{ marginTop: 10, color: "#a93b2c" }}>
          {errorMessage ?? "Failed to queue command."}
        </p>
      )}
    </div>
  );
}
