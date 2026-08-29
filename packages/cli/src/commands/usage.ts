import { isAgentKind } from "@claude-lens/parser";
import { agentSources, cclensPath } from "@claude-lens/parser/fs";
import { flag } from "../args.js";
import { fetchAllClaudeUsage, UsageApiError, type UsageSnapshot } from "../usage/api.js";
import { fetchGrokUsage, GrokApiError } from "../usage/grok.js";
import { fetchCodexUsage, CodexApiError } from "../usage/codex.js";
import { fetchCopilotUsage, CopilotApiError } from "../usage/copilot.js";
import { fetchZaiUsage, ZaiApiError } from "../usage/zai.js";
import { fetchCommandCodeUsage, CommandCodeApiError } from "../usage/command-code.js";
import { formatMultiAgentUsage } from "../usage/format.js";
import { PACE_LEGEND, paceForSnapshot, type SnapshotPace, type WindowPace } from "../usage/pace.js";
import {
  appendSnapshot,
  latestSnapshotsByAgent,
} from "../usage/storage.js";

const USAGE_LOG = cclensPath("usage.jsonl");

async function saveAuxiliarySnapshots(): Promise<number> {
  let saved = 0;
  for (const source of agentSources) {
    if (source.kind === "claude-code" || !source.usagePoller) continue;
    try {
      const partial = await source.usagePoller();
      if (!partial) continue;
      appendSnapshot(USAGE_LOG, {
        ...partial,
        seven_day_opus: null,
        seven_day_sonnet: null,
        seven_day_oauth_apps: null,
        seven_day_cowork: null,
        extra_usage: null,
      });
      saved += 1;
    } catch {
      // Non-fatal for manual --save.
    }
  }
  try {
    appendSnapshot(USAGE_LOG, await fetchCodexUsage());
    saved += 1;
  } catch (err) {
    if (
      !(err instanceof CodexApiError) ||
      (err.code !== "no_auth" && err.code !== "api_key_only")
    ) {
      console.warn(`codex usage: ${(err as Error).message}`);
    }
  }
  try {
    appendSnapshot(USAGE_LOG, await fetchCopilotUsage());
    saved += 1;
  } catch (err) {
    if (
      !(err instanceof CopilotApiError) ||
      (err.code !== "no_cli" && err.code !== "no_auth")
    ) {
      console.warn(`copilot usage: ${(err as Error).message}`);
    }
  }
  try {
    appendSnapshot(USAGE_LOG, await fetchGrokUsage());
    saved += 1;
  } catch (err) {
    if (
      !(err instanceof GrokApiError) ||
      (err.code !== "no_auth" && err.code !== "not_weekly")
    ) {
      console.warn(`grok usage: ${(err as Error).message}`);
    }
  }
  // Z.ai is daemon-polled but not on AgentSource.usagePoller — include it so
  // `usage --save` / cold `--watch --save` can seed a Z.ai-only machine.
  try {
    appendSnapshot(USAGE_LOG, await fetchZaiUsage());
    saved += 1;
  } catch (err) {
    if (!(err instanceof ZaiApiError) || err.code !== "no_key") {
      console.warn(`zai usage: ${(err as Error).message}`);
    }
  }
  try {
    appendSnapshot(USAGE_LOG, await fetchCommandCodeUsage());
    saved += 1;
  } catch (err) {
    if (!(err instanceof CommandCodeApiError) || err.code !== "no_auth") {
      console.warn(`command-code usage: ${(err as Error).message}`);
    }
  }
  return saved;
}

function parseAgentFilter(args: string[]): string | undefined {
  const raw = flag(args, "--agent") ?? flag(args, "-a");
  if (!raw) return undefined;
  const kind = raw.toLowerCase();
  // Accept short labels users type naturally.
  const aliases: Record<string, string> = {
    claude: "claude-code",
    "claude-code": "claude-code",
    codex: "codex",
    copilot: "copilot",
    zai: "zai",
    "z.ai": "zai",
    grok: "grok",
    "command-code": "command-code",
    commandcode: "command-code",
    cmd: "command-code",
  };
  if (aliases[kind]) return aliases[kind];
  // `claude-work` (from ~/.claude-work) → storage key `claude-code:work`.
  if (kind.startsWith("claude-") && kind !== "claude-code") {
    return `claude-code:${kind.slice("claude-".length)}`;
  }
  return kind;
}

function isKnownUsageAgent(kind: string): boolean {
  if (kind.startsWith("claude-code:")) return true;
  return isAgentKind(kind);
}

function filterAgents(
  byAgent: Record<string, UsageSnapshot>,
  agentFilter: string | undefined,
): Record<string, UsageSnapshot> {
  if (!agentFilter) return byAgent;
  if (agentFilter === "claude-code") {
    const hits: Record<string, UsageSnapshot> = {};
    for (const [key, snap] of Object.entries(byAgent)) {
      if (key === "claude-code" || key.startsWith("claude-code:")) hits[key] = snap;
    }
    return hits;
  }
  const hit = byAgent[agentFilter];
  return hit ? { [agentFilter]: hit } : {};
}

function applyLiveClaudeSnapshots(
  byAgent: Record<string, UsageSnapshot>,
  snapshots: UsageSnapshot[],
): void {
  if (snapshots.length === 0) return;
  for (const key of Object.keys(byAgent)) {
    if (key === "claude-code" || key.startsWith("claude-code:")) delete byAgent[key];
  }
  for (const snapshot of snapshots) {
    byAgent[snapshot.agent ?? "claude-code"] = snapshot;
  }
}

/** Build the multi-agent map: log samples, optionally refreshed by a live Claude poll. */
async function collectSnapshots(opts: {
  save: boolean;
  preferLiveClaude: boolean;
}): Promise<{ byAgent: Record<string, UsageSnapshot>; saved: number }> {
  let saved = 0;
  if (opts.save) {
    try {
      const { snapshots } = await fetchAllClaudeUsage();
      for (const snapshot of snapshots) {
        appendSnapshot(USAGE_LOG, snapshot);
        saved += 1;
      }
    } catch (err) {
      if (!(err instanceof UsageApiError)) throw err;
      // Copilot-only machines: still save auxiliaries below.
    }
    saved += await saveAuxiliarySnapshots();
  }

  const byAgent = latestSnapshotsByAgent(USAGE_LOG);

  if (opts.preferLiveClaude && !opts.save) {
    try {
      const { snapshots } = await fetchAllClaudeUsage();
      applyLiveClaudeSnapshots(byAgent, snapshots);
    } catch {
      // Keep log sample (or nothing) for Claude.
    }
  }

  return { byAgent, saved };
}

/** Stable agent-order for machine output (matches terminal multi-agent view). */
const JSON_AGENT_ORDER = ["claude-code", "codex", "copilot", "zai", "grok", "command-code"];

type TaggedSnapshot = UsageSnapshot & {
  agent: string;
  pace?: SnapshotPace;
};

/**
 * Agent-friendly payload for `usage --json`. One object per agent with the
 * same fields as a usage.jsonl line, plus a guaranteed `agent` tag and
 * time-adjusted 7d/30d burn rate (`pace`).
 */
export function usageJsonPayload(
  byAgent: Record<string, UsageSnapshot>,
  opts?: { nowMs?: number },
): { legend: string; agents: TaggedSnapshot[] } {
  const keys = Object.keys(byAgent).sort(compareAgentKeys);
  return {
    legend: PACE_LEGEND,
    agents: keys.map((k) => {
      const s = byAgent[k]!;
      const pace = paceForSnapshot(s, opts?.nowMs);
      return { ...s, agent: s.agent ?? k, ...(pace ? { pace } : {}) };
    }),
  };
}

function compareAgentKeys(a: string, b: string): number {
  const aClaude = a === "claude-code" || a.startsWith("claude-code:");
  const bClaude = b === "claude-code" || b.startsWith("claude-code:");
  if (aClaude || bClaude) {
    if (aClaude && bClaude) {
      if (a === "claude-code") return -1;
      if (b === "claude-code") return 1;
      return a.localeCompare(b);
    }
    return aClaude ? -1 : 1;
  }
  const ia = JSON_AGENT_ORDER.indexOf(a);
  const ib = JSON_AGENT_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return a.localeCompare(b);
}

/** Drop null/undefined recursively — RTK-style: no padding empty fields. */
export function omitNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(omitNulls)
      .filter((v) => v !== null && v !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      const next = omitNulls(v);
      // Drop empty objects left after stripping (e.g. five_hour with only nulls).
      if (
        next &&
        typeof next === "object" &&
        !Array.isArray(next) &&
        Object.keys(next as object).length === 0
      ) {
        continue;
      }
      out[k] = next;
    }
    return out;
  }
  return value;
}

function shortAgentId(agent: string): string {
  if (agent === "claude-code") return "claude";
  if (agent.startsWith("claude-code:")) return `claude-${agent.slice("claude-code:".length)}`;
  if (agent === "command-code") return "cmd";
  return agent;
}

/** Truncate ISO timestamps for dense agent output (minute precision). */
export function shortIso(iso: string): string {
  // 2026-07-28T08:14:04.429Z → 2026-07-28T08:14
  const m = iso.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return m ? m[1]! : iso.slice(0, 16);
}

/**
 * Ultra-dense TOON-like table for agents. Leading legend makes unit/direction
 * self-describing without product docs; `-` = window n/a.
 *
 * Example:
 *   # % of plan quota used ↑busier | 5h/7d/mo | 7d_pace/mo_pace=elapsed%-used% (+slow/-fast; |15|=on_track) | -=n/a
 *   agents[3]{agent,5h,7d,mo,7d_pace,mo_pace,plan,sampled}:
 *   claude,3,20,-,+5,-,-,2026-07-28T08:14
 *   cmd,2.8,34.8,17.4,-3,+8,GOAT,2026-07-28T08:10
 */
export function usageCompactText(
  byAgent: Record<string, UsageSnapshot>,
  opts?: { nowMs?: number },
): string {
  const agents = usageJsonPayload(byAgent, opts).agents;

  const rows = agents.map((a) => {
    const id = shortAgentId(a.agent);
    const fh = a.five_hour?.utilization;
    const sd = a.seven_day?.utilization;
    const mo = a.monthly?.utilization;
    // Spaces → underscores so plan stays a single CSV field.
    const plan = (a.plan_type ?? "-").replace(/\s+/g, "_");
    const at = a.captured_at ? shortIso(a.captured_at) : "-";
    return [
      id,
      cellPct(fh),
      cellPct(sd),
      cellPct(mo),
      cellPace(a.pace?.seven_day),
      cellPace(a.pace?.monthly),
      plan,
      at,
    ].join(",");
  });

  const legend =
    "# % of plan quota used ↑busier | 5h/7d/mo | 7d_pace/mo_pace=elapsed%-used% (+slow/-fast; |15|=on_track) | -=n/a";
  return `${legend}\nagents[${rows.length}]{agent,5h,7d,mo,7d_pace,mo_pace,plan,sampled}:\n${rows.join("\n")}\n`;
}

function cellPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function cellPace(p: WindowPace | undefined): string {
  if (!p) return "-";
  const n = Math.round(p.delta_pp);
  return n > 0 ? `+${n}` : String(n);
}

function emitJson(payload: unknown): void {
  // Minified + null-stripped: agents pay per token, not for pretty-print.
  process.stdout.write(JSON.stringify(omitNulls(payload)) + "\n");
}

function emitMachineError(
  mode: "json" | "compact" | "text",
  msg: string,
): void {
  if (mode === "json") emitJson({ error: msg, agents: [] });
  else if (mode === "compact") process.stdout.write(`error:${msg}\n`);
  else console.error(`Error: ${msg}`);
}

export async function usage(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`fleetlens usage — plan utilization (all agents)

Usage:
  fleetlens usage [--agent KIND]             Human TTY bars
  fleetlens usage --compact [-a KIND]        Dense table for coding agents (token-cheap)
  fleetlens usage --json [-a KIND]           Minified JSON, nulls omitted
  fleetlens usage --watch [-a KIND]          Live top-style view until Ctrl+C
  fleetlens usage --save                     Poll every provider and append to the usage log
  fleetlens usage --history [-s D] [--days N]
                                             Daily token / cost history table

  --compact        Ultra-dense columnar text (recommended for agents / LLM context)
  --json           Machine JSON (minified, nulls stripped; exclusive with --watch/--compact)
  --agent / -a     Filter to one provider (claude | claude-<slug> | codex | copilot | zai | grok | cmd).
                   \`claude\` includes every discovered Claude Code login.

Watch options:
  --interval N   Redraw every N seconds (default 2; reads ~/.cclens/usage.jsonl)

Tip: leave the usage daemon running (\`fleetlens daemon start\`) so --watch
stays fresh without hammering provider APIs.`);
    return;
  }

  if (args.includes("--history")) {
    const { history } = await import("./usage-history.js");
    await history(args.filter((a) => a !== "--history"));
    return;
  }

  const save = args.includes("--save");
  const watch = args.includes("--watch") || args.includes("-w");
  const json = args.includes("--json");
  const compact = args.includes("--compact");
  const machineMode: "json" | "compact" | "text" = json
    ? "json"
    : compact
      ? "compact"
      : "text";
  const agentFilter = parseAgentFilter(args);
  if (agentFilter && !isKnownUsageAgent(agentFilter)) {
    const msg = `unknown agent "${agentFilter}". Use claude, claude-<slug>, codex, copilot, zai, grok, or cmd.`;
    emitMachineError(machineMode, msg);
    process.exitCode = 1;
    return;
  }

  if (watch && (json || compact)) {
    console.error("Error: --watch cannot be combined with --json or --compact");
    process.exitCode = 2;
    return;
  }
  if (json && compact) {
    console.error("Error: --json and --compact are mutually exclusive");
    process.exitCode = 2;
    return;
  }

  const intervalRaw = flag(args, "--interval");
  const intervalSec = Math.max(1, parseInt(intervalRaw ?? "2", 10) || 2);

  if (watch) {
    await runWatch({ agentFilter, intervalSec, saveOnce: save });
    return;
  }

  const collected = await collectSnapshots({ save, preferLiveClaude: true });
  const byAgent = filterAgents(collected.byAgent, agentFilter);

  if (save && collected.saved === 0 && Object.keys(byAgent).length === 0) {
    emitMachineError(machineMode, "could not poll any provider and no samples are on disk.");
    process.exitCode = 1;
    return;
  }
  if (save && collected.saved === 0) {
    const msg = "every usage poll failed (showing last samples from disk only).";
    if (json) {
      emitJson({ ...usageJsonPayload(byAgent), warning: msg });
      process.exitCode = 1;
      return;
    }
    if (compact) {
      // Still emit the table; warning as a comment-ish first line.
      process.stdout.write(`# warning:${msg}\n`);
      process.stdout.write(usageCompactText(byAgent));
      process.exitCode = 1;
      return;
    }
    console.error(`Error: ${msg}`);
    process.exitCode = 1;
  }

  if (Object.keys(byAgent).length === 0) {
    const msg = agentFilter
      ? `no usage samples for ${agentFilter}. Run \`fleetlens usage --save\` or start the daemon.`
      : "no usage samples yet. Run `fleetlens daemon start` or `fleetlens usage --save`.";
    emitMachineError(machineMode, msg);
    process.exitCode = 1;
    return;
  }

  if (json) {
    emitJson(usageJsonPayload(byAgent));
    return;
  }
  if (compact) {
    process.stdout.write(usageCompactText(byAgent));
    return;
  }

  // Omit columns when unknown so format falls back to COLUMNS env / 80.
  const columns =
    typeof process.stdout.columns === "number" && process.stdout.columns > 0
      ? process.stdout.columns
      : undefined;
  process.stdout.write(formatMultiAgentUsage(byAgent, { columns }));
  if (!save) {
    const narrow =
      (columns !== undefined && columns < 48) ||
      (columns === undefined && parseInt(process.env.COLUMNS ?? "", 10) < 48);
    process.stdout.write(
      narrow
        ? "  (tip: --watch · --compact · --json · --save)\n"
        : "  (tip: --watch live · --compact for agents · --json · --history · --save)\n",
    );
  }
}

async function runWatch(opts: {
  agentFilter: string | undefined;
  intervalSec: number;
  saveOnce: boolean;
}): Promise<void> {
  // Always refresh Claude logins once so extra CLAUDE_CONFIG_DIR homes show
  // up even when the running daemon is an older build that only wrote the
  // default claude-code row. Later frames still read the log.
  let saved = 0;
  try {
    const { snapshots } = await fetchAllClaudeUsage();
    for (const snapshot of snapshots) {
      appendSnapshot(USAGE_LOG, snapshot);
      saved += 1;
    }
  } catch {
    // Keep disk samples.
  }
  if (opts.saveOnce) {
    saved += await saveAuxiliarySnapshots();
    if (saved === 0 && Object.keys(latestSnapshotsByAgent(USAGE_LOG)).length === 0) {
      console.error(
        "Error: could not poll any provider and no samples are on disk.",
      );
      process.exitCode = 1;
      return;
    }
  }

  const tty = Boolean(process.stdout.isTTY);
  let stopping = false;

  const leaveScreen = () => {
    if (!tty) return;
    // Show cursor and leave the alternate screen buffer so the user's
    // scrollback is restored exactly like top/htop/less.
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  };

  if (tty) {
    // Enter alt buffer + hide cursor. Frames are drawn in place; without the
    // alt buffer, clear sequences often just scroll and the output appends.
    process.stdout.write("\x1b[?1049h\x1b[?25l");
  }

  const draw = () => {
    if (stopping) return;
    const byAgent = filterAgents(latestSnapshotsByAgent(USAGE_LOG), opts.agentFilter);
    // Prefer live TTY width; leave undefined so format can honor COLUMNS.
    const columns =
      typeof process.stdout.columns === "number" && process.stdout.columns > 0
        ? process.stdout.columns
        : undefined;

    if (tty) {
      // Home cursor + clear whole screen (inside the alt buffer).
      process.stdout.write("\x1b[H\x1b[2J");
    } else {
      // Piped/non-TTY: can't redraw in place — print a separator between frames.
      process.stdout.write("\n────────\n");
    }

    if (Object.keys(byAgent).length === 0) {
      process.stdout.write(
        `\n  ${opts.agentFilter ? `No samples for ${opts.agentFilter}` : "Waiting for usage samples…"}` +
          `\n  Start the daemon: fleetlens daemon start\n` +
          `\n  live · every ${opts.intervalSec}s · Ctrl+C to quit\n`,
      );
      return;
    }
    process.stdout.write(
      formatMultiAgentUsage(byAgent, {
        watch: true,
        intervalSec: opts.intervalSec,
        columns,
      }),
    );
  };

  // Redraw immediately on terminal resize (mobile rotate, pane drag).
  if (tty) {
    process.stdout.on("resize", draw);
  }

  draw();
  const timer = setInterval(draw, opts.intervalSec * 1000);
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    leaveScreen();
    process.stdout.write("\n");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Keep the process alive until signal handlers fire.
  await new Promise<void>(() => {
    // Intentionally never resolves; SIGINT/SIGTERM exit.
  });
}
