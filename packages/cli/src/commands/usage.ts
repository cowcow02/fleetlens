import { fetchUsage, UsageApiError } from "../usage/api.js";
import { fetchGrokUsage, GrokApiError } from "../usage/grok.js";
import { fetchCodexUsage, CodexApiError } from "../usage/codex.js";
import { fetchCopilotUsage, CopilotApiError } from "../usage/copilot.js";
import { formatUsage } from "../usage/format.js";
import { appendSnapshot } from "../usage/storage.js";
import { agentSources, cclensPath } from "@claude-lens/parser/fs";

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
  return saved;
}

export async function usage(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`fleetlens usage — plan utilization snapshot

Usage:
  fleetlens usage [--save]        Current 5h/7d plan utilization
  fleetlens usage --history [-s YYYYMMDD | --days N]
                                  Daily token / cost history table`);
    return;
  }

  if (args.includes("--history")) {
    const { history } = await import("./usage-history.js");
    await history(args.filter((a) => a !== "--history"));
    return;
  }

  const save = args.includes("--save");
  let snapshot: Awaited<ReturnType<typeof fetchUsage>>;
  try {
    snapshot = await fetchUsage();
    if (save) appendSnapshot(USAGE_LOG, snapshot);
    process.stdout.write(formatUsage(snapshot));
  } catch (err) {
    if (!save || !(err instanceof UsageApiError)) {
      if (!(err instanceof UsageApiError)) throw err;
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    // `--save` powers the menu-bar refresh. Keep polling independent agents
    // even on a Copilot-only machine with no Claude Code OAuth token.
    const saved = await saveAuxiliarySnapshots();
    if (saved === 0) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }
  if (save) await saveAuxiliarySnapshots();
  process.stdout.write("\n  (tip: run with --history for the daily token/cost table)\n");
}
