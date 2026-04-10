"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export function DateNav({
  date,
  today,
  prevDay,
  nextDay,
}: {
  date: string;
  today: string;
  prevDay?: string;
  nextDay?: string;
}) {
  const router = useRouter();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {prevDay ? (
        <Link
          href={`/parallelism?date=${prevDay}`}
          style={{
            padding: "5px 10px",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
          }}
        >
          ←
        </Link>
      ) : (
        <span
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            opacity: 0.3,
          }}
        >
          ←
        </span>
      )}

      <input
        type="date"
        value={date}
        onChange={(e) => {
          const val = e.target.value;
          if (val) router.push(`/parallelism?date=${val}`);
        }}
        style={{
          padding: "5px 10px",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          minWidth: 130,
        }}
      />

      {nextDay ? (
        <Link
          href={`/parallelism?date=${nextDay}`}
          style={{
            padding: "5px 10px",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
          }}
        >
          →
        </Link>
      ) : (
        <span
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            opacity: 0.3,
          }}
        >
          →
        </span>
      )}

      <Link
        href={`/parallelism?date=${today}`}
        style={{
          padding: "5px 12px",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 6,
          fontSize: 11,
          color: date === today ? "var(--af-accent)" : "var(--af-text-secondary)",
          background: date === today ? "var(--af-accent-subtle)" : "transparent",
          fontWeight: 500,
        }}
      >
        Today
      </Link>
    </div>
  );
}
