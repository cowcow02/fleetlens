"use client";

/**
 * EntryDayStrip — interleaved daily digest card shown at the top of each
 * day's slice of the transcript. Summarizes outcome, active minutes,
 * brief summary, friction detail, and top user instructions for that
 * local day. Trivial/pending states render simpler placeholders with a
 * call-to-action.
 */
import Link from "next/link";
import React from "react";
import type { Entry } from "@claude-lens/entries";
import { OutcomePill } from "@/components/outcome-pill";

export function EntryDayStrip({ entry }: { entry: Entry }) {
  const fmtDate = new Date(`${entry.local_day}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
  const durMin = Math.round(entry.numbers.active_min);
  const enr = entry.enrichment;
  const isPending = enr.status === "pending" || enr.status === "error";
  const isTrivial = enr.status === "skipped_trivial";

  return (
    <div
      style={{
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 10,
        padding: "12px 16px",
        background: "var(--af-surface)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          📅 {fmtDate}
        </span>
        {isTrivial ? (
          <OutcomePill outcome="trivial" size="md" agent={entry.agent} />
        ) : isPending ? (
          <OutcomePill
            outcome={null}
            pending
            sessionId={entry.session_id}
            localDay={entry.local_day}
            size="md"
            agent={entry.agent}
          />
        ) : enr.outcome ? (
          <OutcomePill outcome={enr.outcome} size="md" agent={entry.agent} />
        ) : null}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            marginLeft: "auto",
          }}
        >
          {durMin}m active
        </span>
      </div>

      {isTrivial && (
        <div style={{ fontSize: 12, color: "var(--af-text-tertiary)", fontStyle: "italic", marginTop: 8 }}>
          Warmup — no enrichment generated.
        </div>
      )}

      {isPending && (
        <div style={{ fontSize: 12, color: "var(--af-text-secondary)", marginTop: 8 }}>
          Click the pending pill to generate this day's digest →
        </div>
      )}

      {enr.status === "done" && (
        <>
          {enr.brief_summary && (
            <p style={{ margin: "10px 0 0", color: "var(--af-text)" }}>{enr.brief_summary}</p>
          )}
          {(enr.friction_detail || enr.user_instructions.length > 0) && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {enr.friction_detail && (
                <div style={{ fontSize: 12, color: "var(--af-text-secondary)" }}>
                  <span style={{ color: "#ed8936" }}>⚠ </span>
                  {enr.friction_detail}
                </div>
              )}
              {enr.user_instructions.length > 0 && (
                <details style={{ fontSize: 12, color: "var(--af-text-secondary)" }}>
                  <summary style={{ cursor: "pointer", color: "var(--af-text-tertiary)" }}>
                    Top user instructions ({enr.user_instructions.length})
                  </summary>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {enr.user_instructions.slice(0, 5).map((u, i) => (
                      <li key={i} style={{ marginBottom: 2 }}>{u}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11 }}>
            <Link
              href={`/digest/${entry.local_day}`}
              style={{ color: "var(--af-accent)", textDecoration: "none" }}
            >
              Open day digest →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
