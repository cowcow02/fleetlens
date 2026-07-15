import { fetchUsage, UsageApiError } from "../usage/api.js";
import { fetchGrokUsage, GrokApiError } from "../usage/grok.js";
import { fetchCodexUsage, CodexApiError } from "../usage/codex.js";
import { formatUsage } from "../usage/format.js";
import { appendSnapshot } from "../usage/storage.js";
import { agentSources, cclensPath } from "@claude-lens/parser/fs";

const USAGE_LOG = cclensPath("usage.jsonl");

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
  try {
    const snapshot = await fetchUsage();
    if (save) appendSnapshot(USAGE_LOG, snapshot);
    process.stdout.write(formatUsage(snapshot));
    // Also poll disk/network agents so menubar force-refresh stays multi-agent.
    if (save) {
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
        } catch {
          // Non-fatal for manual --save.
        }
      }
      try {
        appendSnapshot(USAGE_LOG, await fetchCodexUsage());
      } catch (err) {
        if (
          !(
            err instanceof CodexApiError &&
            (err.code === "no_auth" || err.code === "api_key_only")
          )
        ) {
          // Quiet when Codex isn't logged in; surface nothing on --save.
        }
      }
      try {
        appendSnapshot(USAGE_LOG, await fetchGrokUsage());
      } catch (err) {
        if (!(err instanceof GrokApiError && err.code === "no_auth")) {
          // Quiet when Grok isn't logged in.
        }
      }
    }
    process.stdout.write("\n  (tip: run with --history for the daily token/cost table)\n");
  } catch (err) {
    if (err instanceof UsageApiError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
