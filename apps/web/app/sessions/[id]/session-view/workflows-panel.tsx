"use client";

/* ------------------------------------------------------------------ */
/*  Workflows panel                                                    */
/*                                                                     */
/*  A single `Workflow` tool call collapses a whole dynamic-workflow   */
/*  fan-out into one transcript row. This panel surfaces what that row */
/*  actually did: each run's spawned-agent count, tool calls, tokens,  */
/*  phases, and progress log — the fleet work the transcript hides.    */
/* ------------------------------------------------------------------ */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Workflow as WorkflowIcon,
  Wrench,
  X,
} from "lucide-react";
import type { WorkflowRun } from "@claude-lens/parser";
import { formatGap, formatOffset, formatTokens } from "@/lib/format";
import { shortenToolName } from "../turn-steps";
import { workflowColor } from "./colors";
import { WfMiniStat, SectionLabel } from "./workflows-shared";

export function WorkflowsPanel({
  workflows,
  spawnedAgentCount,
  focusRunId,
  selectedAgentKey,
  onOpenAgent,
  onJumpToParent,
  onClearFocus,
}: {
  workflows: WorkflowRun[];
  spawnedAgentCount: number;
  focusRunId?: string | null;
  selectedAgentKey?: string | null;
  onOpenAgent: (runId: string, agent: WorkflowRun["agents"][number]) => void;
  onJumpToParent: (toolUseId?: string) => void;
  onClearFocus?: () => void;
}) {
  const totalTokens = workflows.reduce((n, w) => n + w.totalTokens, 0);
  const totalTools = workflows.reduce((n, w) => n + w.toolCallCount, 0);
  return (
    <section
      style={{
        marginBottom: 16,
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 10,
        background: "var(--af-surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "10px 14px",
          borderBottom: "1px solid var(--af-border-subtle)",
          background: "var(--af-surface-subtle, rgba(234,88,12,0.04))",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--af-text)",
          }}
        >
          <WorkflowIcon size={14} style={{ color: "#EA580C" }} />
          Workflows
        </span>
        <span
          style={{
            fontSize: 11.5,
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {workflows.length} run{workflows.length === 1 ? "" : "s"} ·{" "}
          {spawnedAgentCount.toLocaleString()} agents · {totalTools.toLocaleString()} tool calls ·{" "}
          {formatTokens(totalTokens)} tok orchestrated
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {workflows.map((w) => (
          <WorkflowCard
            key={w.runId}
            w={w}
            focused={focusRunId === w.runId}
            selectedAgentKey={selectedAgentKey}
            onOpenAgent={onOpenAgent}
            onJumpToParent={onJumpToParent}
            onClearFocus={onClearFocus}
          />
        ))}
      </div>
    </section>
  );
}

function WorkflowCard({
  w,
  focused = false,
  selectedAgentKey,
  onOpenAgent,
  onJumpToParent,
  onClearFocus,
}: {
  w: WorkflowRun;
  focused?: boolean;
  selectedAgentKey?: string | null;
  onOpenAgent: (runId: string, agent: WorkflowRun["agents"][number]) => void;
  onJumpToParent: (toolUseId?: string) => void;
  onClearFocus?: () => void;
}) {
  const [open, setOpen] = useState(focused);
  const cardRef = useRef<HTMLDivElement>(null);
  // Focused via a minimap lane click — expand and scroll this run into view.
  useEffect(() => {
    if (focused) {
      setOpen(true);
      cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focused]);
  const color = workflowColor(w.status);
  const dur = w.durationMs !== undefined ? formatGap(w.durationMs) : "—";
  const startOff = formatOffset(w.startTOffsetMs);

  return (
    <div
      ref={cardRef}
      style={{
        borderTop: "1px solid var(--af-border-subtle)",
        scrollMarginTop: 120,
      }}
    >
      {/* Collapsed header — click to expand */}
      <button
        onClick={() => {
          setOpen((v) => !v);
          // Any toggle is the user taking over from the timeline jump — drop the
          // focus highlight so it doesn't linger on a card they've moved past.
          onClearFocus?.();
        }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--af-text-tertiary)", display: "inline-flex" }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
            color: focused ? "#EA580C" : "var(--af-text)",
            background: focused ? "rgba(234,88,12,0.16)" : "transparent",
            padding: "2px 8px",
            borderRadius: 6,
            transition: "background 0.4s ease, color 0.4s ease",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={w.name}
        >
          {w.name}
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            padding: "2px 7px",
            borderRadius: 100,
            background: color,
            color: "#fff",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {w.status}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "2px 10px",
              borderRadius: 100,
              background: "rgba(234,88,12,0.14)",
              color: "#EA580C",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            {w.agentCount} agents
          </span>
          <WfMiniStat icon={<Wrench size={11} />} value={`${w.toolCallCount.toLocaleString()}`} />
          <WfMiniStat value={`${formatTokens(w.totalTokens)} tok`} />
          <WfMiniStat icon={<Clock size={11} />} value={dur} />
        </span>
      </button>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: "0 14px 14px 38px", display: "flex", flexDirection: "column", gap: 12 }}>
          {w.description && (
            <div style={{ fontSize: 12.5, color: "var(--af-text-secondary)", lineHeight: 1.5 }}>
              {w.description}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--af-text-tertiary)",
            }}
          >
            <span>starts at {startOff}</span>
            {w.model && <span>· {w.model}</span>}
            <span>· runId {w.runId}</span>
            {w.parentToolUseId && (
              <button
                type="button"
                onClick={() => onJumpToParent(w.parentToolUseId)}
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  color: "var(--af-accent)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "var(--font-mono)",
                }}
              >
                Jump to timeline →
              </button>
            )}
          </div>

          {w.agents.length > 0 ? (
            <WorkflowPhaseTabs
              w={w}
              selectedAgentKey={selectedAgentKey}
              onOpenAgent={onOpenAgent}
            />
          ) : (
            w.phases.length > 0 && (
              <div>
                <SectionLabel>Phases</SectionLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {w.phases.map((p, i) => (
                    <span
                      key={`${p.title}-${i}`}
                      title={p.detail}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        padding: "3px 9px",
                        borderRadius: 4,
                        background: "var(--af-border-subtle)",
                        color: "var(--af-text)",
                      }}
                    >
                      <b style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>{p.title}</b>
                      {p.detail && (
                        <span style={{ color: "var(--af-text-tertiary)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.detail}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )
          )}

          {w.logs.length > 0 && <WorkflowRunLog logs={w.logs} />}
        </div>
      )}
    </div>
  );
}

/** Compact model label: "claude-opus-4-8[1m]" → "opus-4-8", "claude-haiku-4-5-20251001" → "haiku-4-5". */
function shortenModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/\[1m\]$/, "")
    .replace(/-\d{6,}$/, "")
    .trim();
}

/** Status dot color for a single workflow-spawned agent. */
function agentStateColor(state?: string): string {
  const s = (state ?? "").toLowerCase();
  if (s === "done" || s === "completed" || s === "success") return "#10B981";
  if (s === "error" || s === "failed") return "#EF4444";
  if (s === "running" || s === "active" || s === "in_progress") return "#F59E0B";
  return "#8A8580";
}

/** Per-phase tabs for a workflow run. Each tab lists the agents (actions)
 *  that ran in that phase so you can review what actually happened. */
function WorkflowPhaseTabs({
  w,
  selectedAgentKey,
  onOpenAgent,
}: {
  w: WorkflowRun;
  selectedAgentKey?: string | null;
  onOpenAgent: (runId: string, agent: WorkflowRun["agents"][number]) => void;
}) {
  // Build the phase list from meta.phases (ordered), bucketing agents by
  // phaseIndex. Agents whose phaseIndex isn't in meta.phases fall into an
  // appended bucket keyed by their phaseTitle so nothing is dropped.
  const groups = useMemo(() => {
    const byIndex = new Map<number, WorkflowRun["agents"]>();
    const extras = new Map<string, WorkflowRun["agents"]>();
    for (const a of w.agents) {
      if (a.phaseIndex && a.phaseIndex >= 1 && a.phaseIndex <= w.phases.length) {
        const arr = byIndex.get(a.phaseIndex) ?? [];
        arr.push(a);
        byIndex.set(a.phaseIndex, arr);
      } else {
        const key = a.phaseTitle ?? "Other";
        const arr = extras.get(key) ?? [];
        arr.push(a);
        extras.set(key, arr);
      }
    }
    const out = w.phases.map((p, i) => ({
      key: `p${i + 1}`,
      title: p.title,
      detail: p.detail,
      agents: byIndex.get(i + 1) ?? [],
    }));
    for (const [title, agents] of extras) {
      out.push({ key: `x-${title}`, title, detail: undefined, agents });
    }
    return out;
  }, [w]);

  // The first phase that actually has agents. For a live workflow this only
  // resolves AFTER agents stream in, so it's recomputed every render.
  const firstWithAgents = groups.find((g) => g.agents.length > 0)?.key ?? groups[0]?.key ?? "";
  // Bug fix: the active tab used to be seeded once via useState(firstWithAgents),
  // so when a live run's phases populated after first mount the selection stayed
  // stuck on the initial (often empty) default. We now track only an explicit
  // user pick; until then the active tab derives from firstWithAgents and follows
  // it reactively. Once the user clicks a tab, `picked` pins the choice.
  const [picked, setPicked] = useState<string | null>(null);
  const active = picked ?? firstWithAgents;
  const activeGroup = groups.find((g) => g.key === active) ?? groups[0];

  return (
    <div>
      <SectionLabel>Phases &amp; actions</SectionLabel>
      {/* Phase tab strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {groups.map((g) => {
          const isActive = g.key === active;
          return (
            <button
              key={g.key}
              onClick={() => setPicked(g.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                fontWeight: isActive ? 600 : 500,
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: isActive ? "#EA580C" : "var(--af-border-subtle)",
                background: isActive ? "rgba(234,88,12,0.12)" : "transparent",
                color: isActive ? "#EA580C" : "var(--af-text-secondary)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              {g.title}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "0px 5px",
                  borderRadius: 100,
                  background: isActive ? "#EA580C" : "var(--af-border-subtle)",
                  color: isActive ? "#fff" : "var(--af-text-tertiary)",
                }}
              >
                {g.agents.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active phase body */}
      {activeGroup && (
        <div>
          {activeGroup.detail && (
            <div
              style={{
                fontSize: 11.5,
                color: "var(--af-text-tertiary)",
                marginBottom: 8,
                fontStyle: "italic",
              }}
            >
              {activeGroup.detail}
            </div>
          )}
          {activeGroup.agents.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--af-text-tertiary)", padding: "8px 0" }}>
              No agents recorded for this phase.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {activeGroup.agents.map((a) => (
                <WorkflowAgentRow
                  key={`${a.index}-${a.agentId ?? a.label}`}
                  a={a}
                  selected={selectedAgentKey === `${w.runId}:${a.agentId ?? a.index}`}
                  onOpen={() => onOpenAgent(w.runId, a)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One agent (action) inside a phase — collapsed shows label + metering;
 *  expanding reveals the task prompt and the returned result. */
/** Full transcript detail for one workflow agent — fetched on demand from
 *  /api/workflow-agent. Mirrors the parser's WorkflowAgentDetail. */
type WfAgentDetail = {
  prompt?: string;
  finalText?: string;
  steps: { index: number; tool: string; preview: string; full?: string; isError?: boolean }[];
  toolCalls: { name: string; count: number }[];
  toolCallCount: number;
  assistantMessageCount: number;
  eventCount: number;
  totalUsage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  model?: string;
  durationMs?: number;
};

function WorkflowAgentRow({
  a,
  selected,
  onOpen,
}: {
  a: WorkflowRun["agents"][number];
  selected: boolean;
  onOpen: () => void;
}) {
  const dur = a.durationMs !== undefined ? formatGap(a.durationMs) : undefined;
  return (
    <button
      onClick={onOpen}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        textAlign: "left",
        cursor: "pointer",
        border: "1px solid",
        borderColor: selected ? "#EA580C" : "var(--af-border-subtle)",
        borderRadius: 6,
        background: selected
          ? "rgba(234,88,12,0.08)"
          : "var(--af-surface-subtle, rgba(120,115,108,0.04))",
        color: "inherit",
        flexWrap: "wrap",
      }}
    >
      <span
        title={a.state}
        style={{ width: 7, height: 7, borderRadius: "50%", background: agentStateColor(a.state), flexShrink: 0 }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--af-text)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 280,
        }}
        title={a.label}
      >
        {a.label}
      </span>
      {a.model && (
        <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {shortenModel(a.model)}
        </span>
      )}
      {a.lastToolSummary && (
        <span
          style={{
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 240,
          }}
          title={a.lastToolSummary}
        >
          → {a.lastToolSummary}
        </span>
      )}
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {dur && <WfMiniStat icon={<Clock size={10} />} value={dur} />}
        {a.tokens !== undefined && <WfMiniStat value={`${formatTokens(a.tokens)} tok`} />}
        {a.toolCalls !== undefined && <WfMiniStat icon={<Wrench size={10} />} value={`${a.toolCalls}`} />}
        <span style={{ color: selected ? "#EA580C" : "var(--af-text-tertiary)", display: "inline-flex" }}>
          <ChevronRight size={14} />
        </span>
      </span>
    </button>
  );
}

// Bug fix: the parent unmounts this drawer when the agent is deselected, so its
// fetched detail used to be lost on close — reopening the same agent refetched
// from scratch and flashed empty. This module-level cache outlives the component
// so a reopen paints the cached detail synchronously. (Stale-while-revalidate: we
// still refetch in the background so a live agent's transcript stays fresh.)
const wfAgentDetailCache = new Map<string, WfAgentDetail>();

/** Right side-sheet showing one workflow agent's full transcript — Task,
 *  ordered Steps, and Result — fetched on demand. Kept out of the card so the
 *  Workflows tab stays short even for 100+ step agents. */
export function WorkflowAgentDrawer({
  sessionId,
  runId,
  agent,
  onClose,
}: {
  sessionId: string;
  runId: string;
  agent: WorkflowRun["agents"][number];
  onClose: () => void;
}) {
  // Seed from the cache on mount so a close+reopen of the same agent paints
  // instantly instead of flashing empty while the refetch runs.
  const [detail, setDetail] = useState<WfAgentDetail | null>(() =>
    agent.agentId
      ? wfAgentDetailCache.get(`${sessionId}:${runId}:${agent.agentId}`) ?? null
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!agent.agentId) {
      setDetail(null);
      return;
    }
    const key = `${sessionId}:${runId}:${agent.agentId}`;
    const cached = wfAgentDetailCache.get(key);
    // Stale-while-revalidate: show the cached detail immediately (no empty flash),
    // and only surface the loading state on a true cache miss.
    if (cached) setDetail(cached);
    else {
      setDetail(null);
      setLoading(true);
    }
    const ctrl = new AbortController();
    const url = `/api/workflow-agent?session=${encodeURIComponent(sessionId)}&run=${encodeURIComponent(runId)}&agent=${encodeURIComponent(agent.agentId)}`;
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: WfAgentDetail) => {
        wfAgentDetailCache.set(key, d);
        setDetail(d);
      })
      .catch((e) => {
        // Don't blank out a shown cached detail if only the revalidation failed.
        if (e?.name !== "AbortError" && !cached) setFailed(true);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [sessionId, runId, agent.agentId]);

  const prompt = detail?.prompt ?? agent.promptPreview;
  const finalText = detail?.finalText ?? agent.resultPreview;
  const dur = detail?.durationMs ?? agent.durationMs;
  const model = detail?.model ?? agent.model;
  const toolCount = detail?.toolCallCount ?? agent.toolCalls;
  const tok = detail ? detail.totalUsage.input + detail.totalUsage.output : agent.tokens;

  return (
    <div>
      {/* Sticky title bar */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--af-surface)",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <span
          title={agent.state}
          style={{ width: 8, height: 8, borderRadius: "50%", background: agentStateColor(agent.state), flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            color: "var(--af-text)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={agent.label}
        >
          {agent.label}
        </span>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--af-text-tertiary)", padding: 4 }}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Meta strip */}
      <div
        style={{
          padding: "9px 18px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {agent.phaseTitle && <span>phase {agent.phaseTitle}</span>}
        {agent.state && <span>· {agent.state}</span>}
        {model && <span>· {shortenModel(model)}</span>}
        {dur !== undefined && <span>· {formatGap(dur)}</span>}
        {toolCount !== undefined && <span>· {toolCount} tools</span>}
        {tok !== undefined && <span>· {formatTokens(tok)} tok</span>}
      </div>

      {/* Body — each section collapsed by default; click to expand. */}
      <div style={{ padding: "12px 18px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && (
          <div style={{ fontSize: 11.5, color: "var(--af-text-tertiary)", fontStyle: "italic" }}>
            Loading full transcript…
          </div>
        )}
        {failed && (
          <div style={{ fontSize: 11.5, color: "var(--af-text-tertiary)", fontStyle: "italic" }}>
            Full transcript unavailable — showing the journal summary.
          </div>
        )}

        {prompt && (
          <DrawerCollapsible title="Task" hint={detail ? undefined : "preview"}>
            <div style={{ fontSize: 12, color: "var(--af-text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {prompt}
            </div>
          </DrawerCollapsible>
        )}

        {detail && detail.steps.length > 0 && (
          <DrawerCollapsible
            title="Steps"
            count={detail.steps.length}
            hint={detail.toolCalls.slice(0, 6).map((t) => `${shortenToolName(t.name)} ×${t.count}`).join("  ·  ")}
          >
            <div style={{ border: "1px solid var(--af-border-subtle)", borderRadius: 6, background: "var(--af-surface)" }}>
              {detail.steps.map((s) => (
                <WorkflowStepRow key={s.index} s={s} />
              ))}
            </div>
          </DrawerCollapsible>
        )}

        {finalText && (
          <DrawerCollapsible title="Result" hint={detail ? undefined : "preview"}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--af-text-secondary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.5,
                background: "var(--af-surface)",
                border: "1px solid var(--af-border-subtle)",
                borderRadius: 4,
                padding: "8px 10px",
              }}
            >
              {finalText}
            </div>
          </DrawerCollapsible>
        )}
      </div>
    </div>
  );
}

/** Collapsible section inside the agent sheet — default collapsed. */
function DrawerCollapsible({
  title,
  count,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid var(--af-border-subtle)", borderRadius: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          background: open ? "var(--af-surface-subtle, rgba(120,115,108,0.05))" : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <span style={{ color: "var(--af-text-tertiary)", display: "inline-flex" }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--af-text-secondary)" }}>
          {title}
        </span>
        {count !== undefined && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 7px",
              borderRadius: 100,
              background: "rgba(234,88,12,0.14)",
              color: "#EA580C",
              fontFamily: "var(--font-mono)",
            }}
          >
            {count}
          </span>
        )}
        {hint && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10.5,
              color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 280,
            }}
          >
            {hint}
          </span>
        )}
      </button>
      {open && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}

/** One step row — click to reveal the full tool input (e.g. the complete
 *  multi-line bash command) when it's longer than the one-line preview. */
function WorkflowStepRow({ s }: { s: WfAgentDetail["steps"][number] }) {
  const [open, setOpen] = useState(false);
  const expandable = !!s.full;
  return (
    <div style={{ borderTop: s.index === 1 ? "none" : "1px solid var(--af-border-subtle)" }}>
      <div
        onClick={() => expandable && setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "4px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <span style={{ color: "var(--af-text-tertiary)", minWidth: 28, textAlign: "right", flexShrink: 0 }}>
          {s.index}
        </span>
        <span style={{ fontWeight: 600, color: s.isError ? "#EF4444" : "var(--af-text)", flexShrink: 0, minWidth: 104 }}>
          {s.isError ? "⚠ " : ""}
          {shortenToolName(s.tool)}
        </span>
        <span
          style={{ flex: 1, color: "var(--af-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={s.preview}
        >
          {s.preview}
        </span>
        {expandable && (
          <span style={{ color: "var(--af-text-tertiary)", display: "inline-flex", flexShrink: 0 }}>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}
      </div>
      {open && s.full && (
        <pre
          style={{
            margin: 0,
            padding: "6px 10px 10px 40px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--af-text-secondary)",
            background: "var(--af-surface-subtle, rgba(120,115,108,0.05))",
            lineHeight: 1.5,
          }}
        >
          {s.full}
        </pre>
      )}
    </div>
  );
}

/** Collapsible coarse run log (▶ / ✓ task markers) — secondary to the
 *  per-phase agent view. */
function WorkflowRunLog({ logs }: { logs: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--af-text-tertiary)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Run log ({logs.length})
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1.7,
            color: "var(--af-text-secondary)",
            background: "var(--af-surface-subtle, rgba(120,115,108,0.05))",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            padding: "8px 12px",
            maxHeight: 240,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
