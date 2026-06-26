"use client";

import { useEffect } from "react";

export function ConcurrencyInfoModal({ onClose }: { onClose: () => void }) {
  // Close on ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="concurrency-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--af-surface-elevated)",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 12,
          maxWidth: 560,
          width: "100%",
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 22px",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <h2
            id="concurrency-modal-title"
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            How concurrency is measured
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--af-text-tertiary)",
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              padding: 0,
              width: 28,
              height: 28,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "18px 22px",
            fontSize: 13,
            color: "var(--af-text-secondary)",
            lineHeight: 1.55,
          }}
        >
          <p style={{ margin: "0 0 14px" }}>
            A <strong style={{ color: "var(--af-text)" }}>concurrency burst</strong>{" "}
            is a window of time when two or more Claude Code sessions were
            actively working in parallel. The goal is to surface moments
            when you were running a multi-agent fleet — not every accidental
            tab overlap.
          </p>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            1. What counts as &quot;active&quot;
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            Each session&apos;s events are split into{" "}
            <strong style={{ color: "var(--af-text)" }}>active segments</strong> —
            stretches of time where no gap between consecutive events exceeds{" "}
            <strong style={{ color: "var(--af-text)" }}>3 minutes</strong>. Any longer
            gap (walked away, laptop closed, thinking) splits the session
            into separate segments.
          </p>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--af-text-tertiary)" }}>
            This is the same definition used for the &quot;active time&quot; metric on
            the dashboard, so numbers stay consistent.
          </p>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            2. Detecting overlap
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            A sweep-line walks every segment start/end across all sessions.
            Whenever the active count is ≥2, that stretch becomes a raw
            overlap. The <strong style={{ color: "var(--af-text)" }}>peak</strong>{" "}
            reported on each burst is the maximum active count reached
            anywhere inside it.
          </p>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            3. Cleaning up noise
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            Raw overlaps are noisy — a typical day produces dozens of
            sub-minute artifacts from switching between sessions. Two rules
            collapse them into human-readable bursts:
          </p>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 22 }}>
            <li style={{ marginBottom: 4 }}>
              <strong style={{ color: "var(--af-text)" }}>Drop under 1 minute</strong> —
              overlaps shorter than that are almost always tab-switch
              artifacts, not real parallel work.
            </li>
            <li>
              <strong style={{ color: "var(--af-text)" }}>Merge within 10 minutes</strong> —
              two overlaps separated by less than 10 minutes of idle time
              fuse into a single burst. A morning of back-and-forth agent
              work becomes one burst, not forty.
            </li>
          </ul>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            4. Same-project vs cross-project
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            Bursts are colored by whether the involved sessions span more
            than one project directory.{" "}
            <span style={{ color: "rgba(167, 139, 250, 1)", fontWeight: 600 }}>
              Purple = cross-project
            </span>{" "}
            — different repos running at once, usually genuine fleet work.{" "}
            <span style={{ color: "rgba(45, 212, 191, 1)", fontWeight: 600 }}>
              Teal = same-project
            </span>{" "}
            — multiple sessions in one repo, usually context-switching
            inside a single task.
          </p>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Why bursts, not runs
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            An earlier version reported every raw overlap as a separate
            &quot;parallel run&quot;. On a busy day that produced 40–80 entries,
            most of them seconds long, most of them meaningless. Bursts are
            the unit humans actually think in: &quot;this morning I was
            running 3 agents at once for about 20 minutes.&quot;
          </p>
        </div>
      </div>
    </div>
  );
}
