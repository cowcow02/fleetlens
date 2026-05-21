"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function TeamWelcomeBanner({
  teamName,
  pairedAt,
}: {
  teamName: string;
  pairedAt: string;
}) {
  const storageKey = `fleetlens:team-welcome-seen:${pairedAt}`;
  const [hidden, setHidden] = useState(true); // start hidden to avoid SSR flash

  useEffect(() => {
    const seen = window.localStorage.getItem(storageKey);
    if (!seen) setHidden(false);
  }, [storageKey]);

  if (hidden) return null;

  const dismiss = () => {
    window.localStorage.setItem(storageKey, "1");
    setHidden(true);
  };

  return (
    <div
      role="status"
      style={{
        margin: "0 0 16px",
        padding: "12px 16px",
        background: "var(--af-accent-subtle)",
        border: "1px solid var(--af-accent)",
        borderRadius: 8,
        color: "var(--af-text)",
        fontSize: 13,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: 1 }}>
        You joined <strong>{teamName}</strong>. Fleetlens now syncs your daily
        activity totals and current cycle utilization to the team dashboard
        every 5 minutes. Transcripts, prompts, and project content never leave
        your machine.{" "}
        <Link href="/settings#team" style={{ color: "var(--af-accent)", textDecoration: "underline" }}>
          See exactly what&apos;s shared →
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--af-text-tertiary)",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: "2px 6px",
        }}
      >
        ×
      </button>
    </div>
  );
}
