"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { usePersistentBoolean } from "@/lib/use-persistent-boolean";

/**
 * Collapsible wrapper for advanced charts that most users don't care about.
 * Preference persists in localStorage (via usePersistentBoolean) and stays
 * in sync with any other component reading the same key.
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
  const [expanded, setExpanded, hydrated] = usePersistentBoolean(storageKey, false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
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
