import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cclensHome } from "@claude-lens/parser/fs";

// Mirrors packages/cli/src/commands/autostart.ts state (plist presence +
// ~/.cclens/autostart.json flags). Reads only — mutations go through the CLI
// binary so the plist always gets the CLI's own node/script paths baked in.

const PLIST = join(homedir(), "Library", "LaunchAgents", "com.fleetlens.daemon.plist");

export type AutostartState = {
  supported: boolean;
  installed: boolean;
  optedOut: boolean;
};

export function readAutostartState(): AutostartState {
  const supported = process.platform === "darwin";
  const installed = supported && existsSync(PLIST);
  let optedOut = false;
  try {
    const flags = JSON.parse(readFileSync(join(cclensHome(), "autostart.json"), "utf8")) as {
      optedOut?: boolean;
    };
    optedOut = flags.optedOut === true;
  } catch {
    // no flags file — never opted out
  }
  return { supported, installed, optedOut };
}
