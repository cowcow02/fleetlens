"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SessionMeta } from "@claude-sessions/parser";
import {
  formatDuration,
  formatRelative,
  formatTokens,
  prettyProjectName,
  shortId,
} from "@/lib/format";
import { Search, Wrench, MessagesSquare, Clock } from "lucide-react";

export function SessionsGrid({ sessions }: { sessions: SessionMeta[] }) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "longest" | "most-tokens">("newest");

  const projects = useMemo(() => {
    const s = new Set(sessions.map((x) => x.projectName));
    return ["all", ...Array.from(s).sort()];
  }, [sessions]);

  const filtered = useMemo(() => {
    let rows = sessions.slice();
    if (project !== "all") rows = rows.filter((s) => s.projectName === project);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          (s.firstUserPreview ?? "").toLowerCase().includes(q) ||
          (s.lastAgentPreview ?? "").toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q),
      );
    }
    if (sortBy === "longest") rows.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
    else if (sortBy === "most-tokens")
      rows.sort(
        (a, b) =>
          b.totalUsage.input +
          b.totalUsage.output +
          b.totalUsage.cacheRead -
          (a.totalUsage.input + a.totalUsage.output + a.totalUsage.cacheRead),
      );
    return rows;
  }, [sessions, project, query, sortBy]);

  return (
    <div>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            flex: 1,
            minWidth: 260,
            maxWidth: 480,
          }}
        >
          <Search
            size={13}
            color="var(--af-text-tertiary)"
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            type="text"
            placeholder="Search by message, project, or ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: "100%", paddingLeft: 32 }}
          />
        </div>
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          style={{ maxWidth: 260 }}
        >
          {projects.map((p) => (
            <option key={p} value={p}>
              {p === "all" ? "All projects" : prettyProjectName(p)}
            </option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="newest">Newest</option>
          <option value="longest">Longest</option>
          <option value="most-tokens">Most tokens</option>
        </select>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {filtered.length}
        </span>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="af-empty">No sessions found.</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 14,
          }}
        >
          {filtered.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session: s }: { session: SessionMeta }) {
  const totalTokens =
    s.totalUsage.input + s.totalUsage.output + s.totalUsage.cacheRead + s.totalUsage.cacheWrite;
  return (
    <Link
      href={`/sessions/${s.id}`}
      className="af-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
      }}
    >
      {/* Header: project + id + time */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={s.projectName}
        >
          {prettyProjectName(s.projectName)}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
            flexShrink: 0,
          }}
          suppressHydrationWarning
        >
          {s.firstTimestamp ? formatRelative(s.firstTimestamp) : "—"}
        </div>
      </div>

      {/* First user message (prompt) */}
      <div
        style={{
          fontSize: 13,
          color: "var(--af-text)",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          minHeight: 36,
          lineHeight: 1.4,
        }}
        title={s.firstUserPreview}
      >
        {s.firstUserPreview || (
          <em style={{ color: "var(--af-text-tertiary)" }}>(no user message)</em>
        )}
      </div>

      {/* Last agent message (conclusion) */}
      <div
        style={{
          fontSize: 11.5,
          color: "var(--af-text-secondary)",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          lineHeight: 1.4,
          paddingLeft: 10,
          borderLeft: "2px solid var(--af-accent-subtle)",
        }}
        title={s.lastAgentPreview}
      >
        {s.lastAgentPreview || <em style={{ color: "var(--af-text-tertiary)" }}>—</em>}
      </div>

      {/* Footer stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 10.5,
          color: "var(--af-text-tertiary)",
          paddingTop: 8,
          borderTop: "1px solid var(--af-border-subtle)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <Stat icon={<MessagesSquare size={11} />} label={`${s.turnCount ?? 0} turn${s.turnCount === 1 ? "" : "s"}`} />
        <Stat icon={<Wrench size={11} />} label={`${s.toolCallCount ?? 0} tools`} />
        <Stat icon={<Clock size={11} />} label={formatDuration(s.durationMs)} />
        <span style={{ marginLeft: "auto" }}>{formatTokens(totalTokens)}</span>
      </div>
    </Link>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {icon}
      {label}
    </span>
  );
}
