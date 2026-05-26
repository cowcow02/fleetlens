"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tab strip across the top of every fluency page so the three variants
 *  are one click apart: Fleetlens method, Anthropic-style, and side-by-side. */
export function FluencyTabs() {
  const pathname = usePathname() ?? "";
  const tabs: Array<{ href: string; label: string }> = [
    { href: "/fluency", label: "Fleetlens method" },
    { href: "/fluency/anthropic", label: "Anthropic-style" },
    { href: "/fluency/compare", label: "Side-by-side" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 10,
        width: "fit-content",
        margin: "0 0 18px",
      }}
    >
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: "6px 12px",
              fontSize: 12.5,
              fontWeight: active ? 600 : 500,
              borderRadius: 7,
              color: active ? "white" : "var(--af-text-secondary)",
              background: active ? "var(--af-accent)" : "transparent",
              textDecoration: "none",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
