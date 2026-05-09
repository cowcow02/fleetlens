import { fetchUsage, UsageApiError } from "../usage/api.js";
import { formatUsage } from "../usage/format.js";
import { appendSnapshot } from "../usage/storage.js";
import { cclensPath } from "@claude-lens/parser/fs";

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
    process.stdout.write("\n  (tip: run with --history for the daily token/cost table)\n");
  } catch (err) {
    if (err instanceof UsageApiError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
