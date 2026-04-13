"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Collapsible wrapper for advanced charts that most users don't care about.
 * Preference persists in localStorage so it stays open/closed across navigations.
 */
export function OptionalChart({
  storageKey,
  label,
  children,
}: {
  storageKey: string;
  label: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "1") setExpanded(true);
    } catch {
      // localStorage might be blocked — fall through to default
    }
    setHydrated(true);
  }, [storageKey]);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          marginBottom: expanded ? 12 : 0,
          background: "transparent",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          color: "var(--af-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          cursor: "pointer",
          transition: "background 0.12s, border-color 0.12s",
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {expanded ? `Hide ${label}` : `Show ${label}`}
      </button>
      {hydrated && expanded && children}
    </div>
  );
}
