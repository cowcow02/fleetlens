import type {
  PresentationRow,
  PresentationRowKind,
  SessionEvent,
} from "@claude-lens/parser";

export type RoleTheme = {
  label: string;
  bg: string;
  fg: string;
  mini: string;
};

/**
 * Palette modeled on Claude Managed Agents' Sessions view — muted,
 * desaturated tones that read cleanly against the cream background.
 * `bg`/`fg` drive the in-row pill; `mini` drives the timeline block fill.
 */
export const ROLE_THEMES: Record<PresentationRowKind, RoleTheme> = {
  user: {
    label: "User",
    bg: "rgba(201, 112, 112, 0.18)",
    fg: "#8B3A3A",
    mini: "#C97070",
  },
  agent: {
    label: "Agent",
    bg: "rgba(92, 132, 195, 0.18)",
    fg: "#2E4A7A",
    mini: "#5C84C3",
  },
  "tool-group": {
    label: "Tool",
    bg: "rgba(138, 133, 128, 0.16)",
    fg: "#44403C",
    mini: "#8A8580",
  },
  interrupt: {
    label: "Interrupt",
    bg: "rgba(217, 119, 6, 0.14)",
    fg: "#78350F",
    mini: "#D97706",
  },
  model: {
    label: "Model",
    bg: "rgba(168, 85, 247, 0.12)",
    fg: "#581C87",
    mini: "#A855F7",
  },
  error: {
    label: "Error",
    bg: "rgba(197, 48, 48, 0.18)",
    fg: "#8B1818",
    mini: "#C53030",
  },
  "task-notification": {
    label: "Task",
    bg: "rgba(100, 116, 139, 0.12)",
    fg: "#475569",
    mini: "#64748B",
  },
};

/** Max number of steps shown inline in a collapsed turn. Larger turns are
 *  truncated with a "+N more" line; the user can click to expand the turn
 *  to see everything. */
export const MAX_INLINE_STEPS = 12;

export function rowPreview(r: PresentationRow): string {
  switch (r.kind) {
    case "user":
      return r.displayPreview ?? r.event.preview;
    case "agent":
      return r.event.preview;
    case "tool-group":
      return formatToolSummary(r.toolNames);
    case "interrupt":
      return "Interrupted";
    case "model":
      return tokenSummaryLine(r.event.usage);
    case "error":
      return r.message;
    case "task-notification": {
      const icon =
        r.status === "success"
          ? "✓"
          : r.status === "failed"
            ? "✗"
            : r.status === "running"
              ? "…"
              : "•";
      return `${icon} ${r.summary}`;
    }
  }
}

/** Render a compact "Bash ×3 · Read ×2 · Grep · Edit" style summary.
 *  Truncates after 4 unique tools with "+N more". */
export function formatToolSummary(
  toolNames: { name: string; count: number }[],
): string {
  const MAX = 4;
  const shown = toolNames.slice(0, MAX);
  const overflow = toolNames.length - MAX;
  const parts = shown.map((t) => {
    const display = shortenToolName(t.name);
    return t.count > 1 ? `${display} ×${t.count}` : display;
  });
  if (overflow > 0) parts.push(`+${overflow} more`);
  return parts.join(" · ");
}

export function tokenSummaryLine(u: SessionEvent["usage"]): string {
  if (!u) return "0 input · 0 output · 0 cache read · 0 cache write";
  return `${u.input} input · ${u.output} output · ${u.cacheRead} cache read · ${u.cacheWrite} cache write`;
}

export function shortenToolName(name: string): string {
  // mcp__plugin_linear_linear__get_issue → linear.get_issue
  const m = name.match(/^mcp__(?:plugin_)?([^_]+)_(?:\1_)?(.+)$/);
  if (m) return `${m[1]}.${m[2]}`;
  // mcp__claude_ai_Gmail__search_threads → gmail.search_threads
  const m2 = name.match(/^mcp__claude_ai_([^_]+)__(.+)$/);
  if (m2) return `${m2[1].toLowerCase()}.${m2[2]}`;
  return name;
}

/** Bulleted list of everything that happened in the middle of a turn.
 *  Each row is a one-line compact entry with role + preview. Capped at
 *  MAX_INLINE_STEPS items with an overflow indicator. */
export function TurnStepsList({
  rows,
  onStepClick,
}: {
  rows: PresentationRow[];
  /** Optional: when set, each step line becomes a button. */
  onStepClick?: (row: PresentationRow, index: number) => void;
}) {
  const overflow = Math.max(0, rows.length - MAX_INLINE_STEPS);
  const shown = overflow > 0 ? rows.slice(-MAX_INLINE_STEPS) : rows;
  const baseIndex = overflow > 0 ? rows.length - shown.length : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        paddingLeft: 2,
        borderLeft: "1px solid var(--af-border-subtle)",
        paddingBlock: 2,
      }}
    >
      {overflow > 0 && (
        <div
          style={{
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            fontStyle: "italic",
            paddingLeft: 12,
            paddingBottom: 2,
          }}
        >
          {overflow} earlier step{overflow === 1 ? "" : "s"} …
        </div>
      )}
      {shown.map((r, i) => {
        const absoluteIndex = baseIndex + i;
        return (
          <TurnStepLine
            key={i}
            row={r}
            onClick={
              onStepClick ? () => onStepClick(r, absoluteIndex) : undefined
            }
          />
        );
      })}
    </div>
  );
}

/** One step in the middle list. Renders a small role marker + the preview
 *  for that row, truncated to one line. */
function TurnStepLine({
  row,
  onClick,
}: {
  row: PresentationRow;
  onClick?: () => void;
}) {
  const theme = ROLE_THEMES[row.kind];
  const label = theme.label;
  const preview = rowPreview(row);
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={{
        display: "grid",
        gridTemplateColumns: "46px 1fr",
        columnGap: 8,
        fontSize: 12,
        lineHeight: 1.45,
        color: row.kind === "error" ? "var(--af-danger)" : "var(--af-text-secondary)",
        cursor: interactive ? "pointer" : undefined,
        borderRadius: interactive ? 3 : undefined,
        padding: interactive ? "2px 4px" : undefined,
        transition: interactive ? "background 0.1s ease" : undefined,
      }}
      onMouseEnter={
        interactive
          ? (e) => {
              (e.currentTarget as HTMLDivElement).style.background =
                "var(--af-surface-hover)";
            }
          : undefined
      }
      onMouseLeave={
        interactive
          ? (e) => {
              (e.currentTarget as HTMLDivElement).style.background = "";
            }
          : undefined
      }
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          background: theme.bg,
          color: theme.fg,
          padding: "1px 6px",
          borderRadius: 3,
          textAlign: "center",
          justifySelf: "start",
          maxWidth: "100%",
        }}
      >
        {label}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {row.kind === "tool-group" ? (
          <span>
            {row.toolNames.slice(0, 4).map((t, i) => (
              <span key={t.name}>
                {i > 0 && (
                  <span style={{ color: "var(--af-text-tertiary)", margin: "0 5px" }}>·</span>
                )}
                <b style={{ fontWeight: 600 }}>{shortenToolName(t.name)}</b>
                {t.count > 1 && (
                  <span
                    style={{
                      color: "var(--af-text-tertiary)",
                      fontFamily: "var(--font-mono)",
                      marginLeft: 3,
                    }}
                  >
                    ×{t.count}
                  </span>
                )}
              </span>
            ))}
            {row.toolNames.length > 4 && (
              <span
                style={{
                  color: "var(--af-text-tertiary)",
                  marginLeft: 6,
                  fontSize: 10,
                }}
              >
                +{row.toolNames.length - 4}
              </span>
            )}
          </span>
        ) : (
          preview
        )}
      </span>
    </div>
  );
}
