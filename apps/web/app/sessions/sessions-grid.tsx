"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AgentKind, SessionMeta } from "@claude-lens/parser";
import { getAgentMetadata, isAgentKind } from "@claude-lens/parser";
import type { DayOutcome, EntryEnrichmentStatus } from "@claude-lens/entries";
import {
  formatDuration,
  formatRelative,
  formatTokens,
  prettyProjectName,
  shortId,
} from "@/lib/format";
import { Search, Wrench, MessagesSquare, Clock, Workflow as WorkflowIcon } from "lucide-react";
import { LiveBadge } from "@/components/live-badge";
import { TeamBadge } from "@/components/team-badge";
import { AgentBadge } from "@/components/agent-badge";
import { DataTable, type Column } from "@/components/data-table";
import { useViewToggle } from "@/components/view-toggle";
import { OutcomePill, outcomePriority } from "@/components/outcome-pill";

export type SessionRow = {
  session: SessionMeta;
  outcome: DayOutcome | null;
  briefSummary: string | null;
  enrichmentStatus: EntryEnrichmentStatus | null;
  latestLocalDay: string | null;
};

type SortBy = "newest" | "longest" | "most-tokens" | "outcome";

const SORT_VALUES: readonly SortBy[] = ["newest", "longest", "most-tokens", "outcome"] as const;

function isSortBy(s: string | null | undefined): s is SortBy {
  return s !== null && s !== undefined && (SORT_VALUES as readonly string[]).includes(s);
}

export function SessionsGrid({ rows }: { rows: SessionRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Filter state lives in the URL — back/forward replays the same view, and
  // returning from a session detail page restores what the user had picked.
  const query = searchParams.get("q") ?? "";
  const project = searchParams.get("project") ?? "all";
  const agentParam = searchParams.get("agent");
  const agent: AgentKind | "all" = isAgentKind(agentParam) ? agentParam : "all";
  const sortBy: SortBy = isSortBy(searchParams.get("sort"))
    ? (searchParams.get("sort") as SortBy)
    : "newest";
  const { mode: viewMode, toggle: viewToggle } = useViewToggle("cclens:sessions:view");

  const updateParam = useCallback(
    (key: string, value: string, fallback: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (!value || value === fallback) next.delete(key);
      else next.set(key, value);
      const qs = next.toString();
      // replace, not push — we don't want a history entry per keystroke.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setQuery = (v: string) => updateParam("q", v, "");
  const setProject = (v: string) => updateParam("project", v, "all");
  const setAgent = (v: AgentKind | "all") => updateParam("agent", v, "all");
  const setSortBy = (v: SortBy) => updateParam("sort", v, "newest");

  const projects = useMemo(() => {
    const s = new Set(rows.map((r) => r.session.projectName));
    return ["all", ...Array.from(s).sort()];
  }, [rows]);

  const agentOptions = useMemo(() => {
    const counts = new Map<AgentKind, number>();
    for (const r of rows) {
      const k = (r.session.agent ?? "claude-code") as AgentKind;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const filtered = useMemo(() => {
    let items = rows.slice();
    if (project !== "all") items = items.filter((r) => r.session.projectName === project);
    if (agent !== "all")
      items = items.filter((r) => (r.session.agent ?? "claude-code") === agent);
    if (query) {
      const q = query.toLowerCase();
      items = items.filter(
        ({ session: s, briefSummary }) =>
          s.id.toLowerCase().includes(q) ||
          (briefSummary ?? "").toLowerCase().includes(q) ||
          (s.firstUserPreview ?? "").toLowerCase().includes(q) ||
          (s.lastAgentPreview ?? "").toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q),
      );
    }
    if (sortBy === "newest")
      items.sort(
        (a, b) =>
          (b.session.firstTimestamp ? Date.parse(b.session.firstTimestamp) : 0) -
          (a.session.firstTimestamp ? Date.parse(a.session.firstTimestamp) : 0),
      );
    else if (sortBy === "longest")
      items.sort(
        (a, b) =>
          (b.session.airTimeMs ?? b.session.durationMs ?? 0) -
          (a.session.airTimeMs ?? a.session.durationMs ?? 0),
      );
    else if (sortBy === "most-tokens")
      items.sort(
        (a, b) =>
          b.session.totalUsage.input +
          b.session.totalUsage.output +
          b.session.totalUsage.cacheRead -
          (a.session.totalUsage.input +
            a.session.totalUsage.output +
            a.session.totalUsage.cacheRead),
      );
    else if (sortBy === "outcome")
      items.sort((a, b) => outcomePriority(b.outcome) - outcomePriority(a.outcome));
    return items;
  }, [rows, project, agent, query, sortBy]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 260, maxWidth: 480 }}>
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
        {agentOptions.length > 1 && (
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as typeof agent)}
            title="Filter by source agent"
          >
            <option value="all">All agents</option>
            {agentOptions.map(([k, count]) => (
              <option key={k} value={k}>
                {agentLabel(k)} ({count})
              </option>
            ))}
          </select>
        )}
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="newest">Newest</option>
          <option value="longest">Longest</option>
          <option value="most-tokens">Most tokens</option>
          <option value="outcome">Outcome</option>
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
        {viewToggle}
      </div>

      {filtered.length === 0 ? (
        <div className="af-empty">No sessions found.</div>
      ) : viewMode === "table" ? (
        <DataTable<SessionRow>
          rows={filtered}
          getRowKey={(r) => `${r.session.projectDir}/${r.session.id}`}
          onRowClick={(r) => router.push(`/sessions/${r.session.id}`)}
          defaultSortKey="lastActive"
          defaultSortDir="desc"
          columns={sessionTableColumns}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 14,
          }}
        >
          {filtered.map((r) => (
            <SessionCard key={`${r.session.projectDir}/${r.session.id}`} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

const sessionTableColumns: Column<SessionRow>[] = [
  {
    key: "outcome",
    header: "Outcome",
    sortValue: (r) => outcomePriority(r.outcome),
    render: (r) => <OutcomeCell row={r} />,
  },
  {
    key: "project",
    header: "Project",
    sortValue: (r) => r.session.projectName,
    render: (r) => (
      <div
        style={{
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={r.session.projectName}
      >
        <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {prettyProjectName(r.session.projectName)}
          </span>
          <TeamBadge session={r.session} />
          <AgentBadge agent={r.session.agent} />
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {shortId(r.session.id)}
        </div>
      </div>
    ),
  },
  {
    key: "preview",
    header: "Summary",
    sortable: false,
    render: (r) => {
      const text = r.briefSummary ?? r.session.firstUserPreview ?? "";
      const isFallback = !r.briefSummary;
      return (
        <div
          style={{
            maxWidth: 360,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: isFallback ? "var(--af-text-tertiary)" : "var(--af-text-secondary)",
            fontStyle: isFallback ? "italic" : "normal",
          }}
          title={isFallback ? `(raw user message) ${text}` : text}
        >
          {text || "—"}
        </div>
      );
    },
  },
  {
    key: "created",
    header: "Created",
    sortValue: (r) => (r.session.firstTimestamp ? Date.parse(r.session.firstTimestamp) : 0),
    align: "right",
    render: (r) => (
      <span suppressHydrationWarning style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {r.session.firstTimestamp ? formatRelative(r.session.firstTimestamp) : "—"}
      </span>
    ),
  },
  {
    key: "lastActive",
    header: "Last active",
    sortValue: (r) => (r.session.lastTimestamp ? Date.parse(r.session.lastTimestamp) : 0),
    align: "right",
    render: (r) => (
      <span suppressHydrationWarning style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {r.session.lastTimestamp ? formatRelative(r.session.lastTimestamp) : "—"}
      </span>
    ),
  },
  {
    key: "airtime",
    header: "Agent time",
    sortValue: (r) => r.session.airTimeMs ?? r.session.durationMs ?? 0,
    align: "right",
    render: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {formatDuration(r.session.airTimeMs ?? r.session.durationMs ?? 0)}
      </span>
    ),
  },
  {
    key: "turns",
    header: "Turns",
    sortValue: (r) => r.session.turnCount ?? 0,
    align: "right",
    render: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {(r.session.turnCount ?? 0).toLocaleString()}
      </span>
    ),
  },
  {
    key: "tools",
    header: "Tool calls",
    sortValue: (r) => r.session.toolCallCount ?? 0,
    align: "right",
    render: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {(r.session.toolCallCount ?? 0).toLocaleString()}
      </span>
    ),
  },
  {
    key: "tokens",
    header: "Tokens",
    sortValue: (r) =>
      r.session.totalUsage.input +
      r.session.totalUsage.output +
      r.session.totalUsage.cacheRead +
      r.session.totalUsage.cacheWrite,
    align: "right",
    render: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {formatTokens(
          r.session.totalUsage.input +
            r.session.totalUsage.output +
            r.session.totalUsage.cacheRead +
            r.session.totalUsage.cacheWrite,
        )}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    sortValue: (r) => (r.session.status === "running" ? 1 : 0),
    align: "center",
    render: (r) =>
      r.session.status === "running" ? <LiveBadge /> : <span style={{ opacity: 0.4 }}>—</span>,
  },
];

function OutcomeCell({ row }: { row: SessionRow }) {
  if (row.outcome) {
    return <OutcomePill outcome={row.outcome} size="sm" label="text" agent={row.session.agent} />;
  }
  if (row.enrichmentStatus && row.latestLocalDay && row.enrichmentStatus !== "skipped_trivial") {
    return (
      <OutcomePill
        outcome={null}
        pending
        sessionId={row.session.id}
        localDay={row.latestLocalDay}
        size="sm"
        agent={row.session.agent}
      />
    );
  }
  return <span style={{ color: "var(--af-text-tertiary)", fontSize: 10 }}>—</span>;
}

function SessionCard({ row }: { row: SessionRow }) {
  const router = useRouter();
  const { session: s, briefSummary, outcome, latestLocalDay, enrichmentStatus } = row;
  const totalTokens =
    s.totalUsage.input + s.totalUsage.output + s.totalUsage.cacheRead + s.totalUsage.cacheWrite;
  const showPending =
    !outcome && enrichmentStatus && enrichmentStatus !== "skipped_trivial" && latestLocalDay;
  const body = briefSummary ?? s.firstUserPreview ?? "";
  const bodyIsFallback = !briefSummary;

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
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
          title={s.projectName}
        >
          <LiveBadge mtimeIso={s.lastTimestamp} activityMs={s.lastActivityMs} />
          <span
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {prettyProjectName(s.projectName)}
          </span>
          <TeamBadge session={s} linkable={false} />
          <AgentBadge agent={s.agent} />
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

      {(outcome || showPending) && (
        <div onClick={(e) => e.stopPropagation()}>
          {outcome ? (
            <OutcomePill outcome={outcome} size="md" agent={s.agent} />
          ) : showPending ? (
            // The card body is a <Link>, so the pending pill can't be its own
            // <Link> (nested <a> → hydration error). Render it as a non-anchor
            // and drive the /digest navigation from here instead.
            <span
              role="link"
              tabIndex={0}
              title={`Generate ${latestLocalDay} digest →`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(`/digest/${latestLocalDay}`);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  router.push(`/digest/${latestLocalDay}`);
                }
              }}
              style={{ cursor: "pointer", display: "inline-flex" }}
            >
              <OutcomePill
                outcome={null}
                pending
                sessionId={s.id}
                localDay={latestLocalDay!}
                size="md"
                agent={s.agent}
                noLink
              />
            </span>
          ) : null}
        </div>
      )}

      <div
        style={{
          fontSize: 13,
          color: bodyIsFallback ? "var(--af-text-secondary)" : "var(--af-text)",
          fontStyle: bodyIsFallback ? "italic" : "normal",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          minHeight: 36,
          lineHeight: 1.4,
        }}
        title={bodyIsFallback ? `(raw user message) ${body}` : body}
      >
        {body || <em style={{ color: "var(--af-text-tertiary)" }}>(no user message)</em>}
      </div>

      {bodyIsFallback && (
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
      )}

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
        <Stat
          icon={<MessagesSquare size={11} />}
          label={`${s.turnCount ?? 0} turn${s.turnCount === 1 ? "" : "s"}`}
        />
        <Stat icon={<Wrench size={11} />} label={`${s.toolCallCount ?? 0} tools`} />
        {(s.spawnedAgentCount ?? 0) > 0 && (
          <span
            style={{ display: "flex", alignItems: "center", gap: 4, color: "#EA580C", fontWeight: 600 }}
            title={`${s.workflowCount} workflow${s.workflowCount === 1 ? "" : "s"} spawned ${s.spawnedAgentCount} agents`}
          >
            <WorkflowIcon size={11} />
            {s.spawnedAgentCount} agents
          </span>
        )}
        <Stat icon={<Clock size={11} />} label={formatDuration(s.airTimeMs ?? s.durationMs)} />
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

// Registry-driven label — reads displayName off the agent metadata so
// new agents auto-show up with their declared name.
function agentLabel(kind: AgentKind): string {
  return getAgentMetadata(kind)?.displayName ?? kind;
}
