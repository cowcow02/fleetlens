"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { RangeKey } from "../lib/queries";

const OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
];

export function RangeTabs({ value }: { value: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(next: RangeKey) {
    if (next === value) return;
    const sp = new URLSearchParams(params.toString());
    sp.set("range", next);
    // scroll: false — toggle is a chart-zoom action, not a navigation;
    // keeping the user's scroll position avoids losing the chart they
    // were looking at when they reached for the button.
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  return (
    <div
      role="tablist"
      aria-label="Time range"
      style={{
        display: "inline-flex",
        border: "1px solid var(--rule)",
        borderRadius: 2,
        overflow: "hidden",
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      {OPTIONS.map((o, i) => {
        const selected = o.key === value;
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={selected}
            type="button"
            onClick={() => select(o.key)}
            style={{
              padding: "5px 12px",
              fontSize: 11,
              letterSpacing: "0.08em",
              cursor: "pointer",
              border: "none",
              borderRight: i < OPTIONS.length - 1 ? "1px solid var(--rule)" : "none",
              background: selected ? "var(--ink)" : "transparent",
              color: selected ? "var(--paper)" : "var(--mute)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
