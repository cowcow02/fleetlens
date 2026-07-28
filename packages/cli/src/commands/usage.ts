import { isAgentKind } from "@claude-lens/parser";
import { agentSources, cclensPath } from "@claude-lens/parser/fs";
import { flag } from "../args.js";
import { fetchUsage, UsageApiError, type UsageSnapshot } from "../usage/api.js";
import { fetchGrokUsage, GrokApiError } from "../usage/grok.js";
import { fetchCodexUsage, CodexApiError } from "../usage/codex.js";
import { fetchCopilotUsage, CopilotApiError } from "../usage/copilot.js";
import { fetchZaiUsage, ZaiApiError } from "../usage/zai.js";
import { formatMultiAgentUsage } from "../usage/format.js";
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
  };
  return aliases[kind] ?? kind;
}

function filterAgents(
  byAgent: Record<string, UsageSnapshot>,
  agentFilter: string | undefined,
): Record<string, UsageSnapshot> {
  if (!agentFilter) return byAgent;
  const hit = byAgent[agentFilter];
  return hit ? { [agentFilter]: hit } : {};
}

/** Build the multi-agent map: log samples, optionally refreshed by a live Claude poll. */
async function collectSnapshots(opts: {
  save: boolean;
  preferLiveClaude: boolean;
}): Promise<{ byAgent: Record<string, UsageSnapshot>; saved: number }> {
  let saved = 0;
  if (opts.save) {
    try {
      const snapshot = await fetchUsage();
      appendSnapshot(USAGE_LOG, snapshot);
      saved += 1;
    } catch (err) {
      if (!(err instanceof UsageApiError)) throw err;
      // Copilot-only machines: still save auxiliaries below.
    }
    saved += await saveAuxiliarySnapshots();
  }

  const byAgent = latestSnapshotsByAgent(USAGE_LOG);

  if (opts.preferLiveClaude && !opts.save) {
    try {
      const live = await fetchUsage();
      byAgent["claude-code"] = live;
    } catch {
      // Keep log sample (or nothing) for Claude.
    }
  }

  return { byAgent, saved };
}

export async function usage(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`fleetlens usage — plan utilization (all agents)

Usage:
  fleetlens usage [--agent KIND]           Multi-agent snapshot (from daemon log + live Claude)
  fleetlens usage --watch [-a KIND]        Live top-style view until Ctrl+C
  fleetlens usage --save                   Poll every provider and append to the usage log
  fleetlens usage --history [-s D] [--days N]
                                           Daily token / cost history table

Agents: claude | codex | copilot | zai | grok  (or full ids like claude-code)
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
  const agentFilter = parseAgentFilter(args);
  if (agentFilter && !isAgentKind(agentFilter)) {
    console.error(
      `Error: unknown agent "${agentFilter}". Use claude, codex, copilot, zai, or grok.`,
    );
    process.exitCode = 1;
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
    console.error(
      "Error: could not poll any provider and no samples are on disk.",
    );
    process.exitCode = 1;
    return;
  }
  if (save && collected.saved === 0) {
    console.error(
      "Error: every usage poll failed (showing last samples from disk only).",
    );
    process.exitCode = 1;
  }

  if (Object.keys(byAgent).length === 0) {
    if (agentFilter) {
      console.error(
        `Error: no usage samples for ${agentFilter}. Run \`fleetlens usage --save\` or start the daemon.`,
      );
    } else {
      console.error(
        "Error: no usage samples yet. Run `fleetlens daemon start` or `fleetlens usage --save`.",
      );
    }
    process.exitCode = 1;
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
        ? "  (tip: --watch · --history · --save)\n"
        : "  (tip: --watch for a live view · --history for the token table · --save to poll APIs)\n",
    );
  }
}

async function runWatch(opts: {
  agentFilter: string | undefined;
  intervalSec: number;
  saveOnce: boolean;
}): Promise<void> {
  if (opts.saveOnce) {
    // One poll up front so the first frame isn't empty on a cold machine.
    const { saved } = await collectSnapshots({ save: true, preferLiveClaude: false });
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
  let timer: ReturnType<typeof setInterval> | undefined;

  const leaveScreen = () => {
    if (!tty) return;
    // Show cursor and leave the alternate screen buffer so the user's
    // scrollback is restored exactly like top/htop/less.
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  };

  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (timer) clearInterval(timer);
    leaveScreen();
    process.stdout.write("\n");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

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
  timer = setInterval(draw, opts.intervalSec * 1000);
  // Keep the process alive until signal handlers fire.
  await new Promise<void>(() => {
    // Intentionally never resolves; SIGINT/SIGTERM exit.
  });
}
