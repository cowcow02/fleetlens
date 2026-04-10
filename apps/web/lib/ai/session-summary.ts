/**
 * Compact text summary of a parsed session, suitable as context for
 * the Ask Claude feature. Target: well under 8k tokens so Haiku has
 * room for an answer.
 *
 * Shape:
 *   # Session <id>
 *   project: <path>
 *   model: <model>
 *   duration: 2h 14m  |  active: 47m
 *   events: 2836  |  tokens: 1.2k in / 689k out (+288M cached)
 *   tool calls: 413 (Bash×120, Read×88, Edit×54, ...)
 *   started: <iso>
 *
 *   ## First user message
 *   <one or two paragraphs>
 *
 *   ## Timeline
 *   [0:00:12] USER: <preview>
 *   [0:00:15] TURN: 8 msgs, 23 tools — first: "..." → final: "..."
 *   [0:05:31] USER: <preview>
 *   [0:05:33] TURN: 2 msgs, 0 tools — ...
 *   ...
 *
 *   ## PRs shipped
 *   - at 1h 12m (64% into session): gh pr create --title "..."
 *
 *   ## Errors encountered
 *   (none | N errors, first: "...")
 *
 *   ## Final agent message
 *   <last conclusion text, first 800 chars>
 */

import {
  buildPresentation,
  buildMegaRows,
  type SessionDetail,
  type MegaRow,
  type PresentationRow,
} from "@claude-sessions/parser";
import { formatOffset, formatDuration, formatTokens } from "@/lib/format";

/** Max rows from the turn stream to include — guards against absurdly long sessions. */
const MAX_TURNS = 40;
/** Max characters to include per turn preview. */
const TURN_PREVIEW_MAX = 180;
/** Max characters of the final conclusion. */
const FINAL_MAX = 800;
/** Max characters of the first user message. */
const FIRST_MSG_MAX = 1200;

function trunc(s: string, n: number): string {
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function rowPreview(r: PresentationRow): string {
  switch (r.kind) {
    case "user":
      return r.displayPreview ?? r.event.preview;
    case "agent":
      return r.event.preview;
    case "tool-group":
      return r.toolNames
        .slice(0, 4)
        .map((t) => (t.count > 1 ? `${t.name} ×${t.count}` : t.name))
        .join(", ");
    case "interrupt":
      return "[interrupted]";
    case "model":
      return "[zero-usage response]";
    case "error":
      return `ERROR: ${r.message}`;
    case "task-notification":
      return `BG task ${r.status}: ${r.summary}`;
  }
}

export function summarizeSessionForAI(session: SessionDetail): string {
  const rows = buildPresentation(session.events);
  const megaRows = buildMegaRows(rows);

  const totalIn =
    session.totalUsage.input + session.totalUsage.cacheRead + session.totalUsage.cacheWrite;
  const totalCached = session.totalUsage.cacheRead + session.totalUsage.cacheWrite;

  // Aggregate tool-call counts
  const toolCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === "tool-group") {
      for (const t of r.toolNames) {
        toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + t.count);
      }
    }
  }
  const topTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n, c]) => `${n}×${c}`)
    .join(", ");

  // Find first user message (skipping slash commands)
  const firstUserRow = rows.find(
    (r) =>
      r.kind === "user" &&
      !(r.event.preview.startsWith("<command-name>")) &&
      !(r.event.preview.startsWith("Base directory for this skill:")),
  );
  const firstUserText =
    firstUserRow?.kind === "user"
      ? firstUserRow.displayBlocks?.[0]?.type === "text"
        ? firstUserRow.displayBlocks[0].text
        : firstUserRow.event.blocks.find(
            (b) => b && (b as { type?: string }).type === "text",
          )?.type === "text"
          ? (
              firstUserRow.event.blocks.find(
                (b) => b && (b as { type?: string }).type === "text",
              ) as { text: string }
            ).text
          : firstUserRow.event.preview
      : "";

  // Errors
  const errorRows = rows.filter((r) => r.kind === "error");
  const errorSection =
    errorRows.length > 0
      ? `${errorRows.length} errors, first: "${trunc(errorRows[0]!.kind === "error" ? errorRows[0]!.message : "", 160)}"`
      : "none";

  // PR markers (scan events for `gh pr create`)
  type PrMark = { offsetPct: number; titleOrCmd: string };
  const prMarks: PrMark[] = [];
  const total = session.durationMs ?? 0;
  for (const e of session.events) {
    if (e.role !== "tool-call" || e.toolName !== "Bash") continue;
    const tb = e.blocks.find(
      (b) => b && (b as { type?: string }).type === "tool_use",
    ) as { type: "tool_use"; input?: Record<string, unknown> } | undefined;
    const cmd =
      typeof tb?.input?.command === "string" ? (tb.input.command as string) : "";
    if (!/gh\s+pr\s+create\b/i.test(cmd)) continue;
    const titleMatch = cmd.match(/--title\s+["']([^"']+)["']/);
    const titleOrCmd = titleMatch?.[1] ?? cmd.replace(/^gh pr create /, "").slice(0, 120);
    const offsetPct =
      total > 0 && e.tOffsetMs !== undefined
        ? Math.round((e.tOffsetMs / total) * 100)
        : 0;
    prMarks.push({ offsetPct, titleOrCmd });
  }

  // Final conclusion text — walk megaRows backward for the last "turn" conclusion
  let finalText = "";
  for (let i = megaRows.length - 1; i >= 0; i--) {
    const m = megaRows[i]!;
    if (m.kind !== "turn") continue;
    const idx = m.summary.finalAgentIndex;
    if (idx !== undefined) {
      const r = m.rows[idx];
      if (r?.kind === "agent") {
        const textBlock = r.event.blocks.find(
          (b) => b && (b as { type?: string }).type === "text",
        ) as { type: "text"; text: string } | undefined;
        finalText = textBlock?.text ?? r.event.preview;
        break;
      }
    }
  }

  // Timeline: user rows + turn summaries, truncated to MAX_TURNS entries.
  type TimelineEntry = { offset: string; line: string };
  const timeline: TimelineEntry[] = [];
  for (const m of megaRows) {
    if (timeline.length >= MAX_TURNS) {
      timeline.push({ offset: "...", line: `(+${megaRows.length - timeline.length} more rows)` });
      break;
    }
    if (m.kind === "user") {
      const preview = trunc(rowPreview(m), TURN_PREVIEW_MAX);
      if (!preview.startsWith("<command-name>")) {
        timeline.push({ offset: formatOffset(m.tOffsetMs), line: `USER: ${preview}` });
      }
    } else if (m.kind === "turn") {
      const s = m.summary;
      const first = s.firstAgentPreview ? trunc(s.firstAgentPreview, TURN_PREVIEW_MAX) : "";
      const final = s.finalAgentPreview ? trunc(s.finalAgentPreview, TURN_PREVIEW_MAX) : "";
      const same = first && final && first === final;
      const topToolsInTurn = s.toolNames
        .slice(0, 3)
        .map((t) => (t.count > 1 ? `${t.name}×${t.count}` : t.name))
        .join(", ");
      const stats = `${s.agentMessages} msg, ${s.toolCalls} tools${s.errors > 0 ? `, ${s.errors} err` : ""}`;
      const body = same || !final ? first : `${first} → ${final}`;
      timeline.push({
        offset: formatOffset(m.tOffsetMs),
        line: `TURN (${stats}${topToolsInTurn ? `, ${topToolsInTurn}` : ""}): ${body}`,
      });
    } else if (m.kind === "interrupt") {
      timeline.push({ offset: formatOffset(m.tOffsetMs), line: "INTERRUPT" });
    }
  }

  const lines: string[] = [];
  lines.push(`# Session ${session.id}`);
  lines.push(`project: ${session.projectName}`);
  if (session.model) lines.push(`model: ${session.model}`);
  lines.push(
    `duration: ${formatDuration(session.durationMs)}  |  active: ${formatDuration(
      session.airTimeMs ?? session.durationMs,
    )}`,
  );
  lines.push(
    `events: ${session.eventCount}  |  tokens: ${formatTokens(totalIn)} in / ${formatTokens(session.totalUsage.output)} out${
      totalCached > 0 ? ` (+${formatTokens(totalCached)} cached)` : ""
    }`,
  );
  lines.push(`tool calls: ${session.toolCallCount ?? 0}${topTools ? ` (${topTools})` : ""}`);
  lines.push(`turns: ${session.turnCount ?? 0}`);
  if (session.firstTimestamp) lines.push(`started: ${session.firstTimestamp}`);
  lines.push("");

  if (firstUserText) {
    lines.push("## First user message");
    lines.push(trunc(firstUserText, FIRST_MSG_MAX));
    lines.push("");
  }

  lines.push("## Timeline");
  for (const t of timeline) {
    lines.push(`[${t.offset}] ${t.line}`);
  }
  lines.push("");

  if (prMarks.length > 0) {
    lines.push("## PRs shipped");
    for (const p of prMarks) {
      lines.push(`- at ${p.offsetPct}% into session: ${trunc(p.titleOrCmd, 160)}`);
    }
    lines.push("");
  }

  lines.push(`## Errors encountered`);
  lines.push(errorSection);
  lines.push("");

  if (finalText) {
    lines.push("## Final agent message");
    lines.push(trunc(finalText, FINAL_MAX));
  }

  return lines.join("\n");
}
