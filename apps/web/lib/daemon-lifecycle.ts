import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type DaemonRunner = (file: string, args: string[]) => Promise<void>;
type DaemonEnv = Partial<NodeJS.ProcessEnv> & {
  FLEETLENS_CLI_BIN?: string;
  FLEETLENS_WEB_START_DAEMON?: string;
};

let startInFlight: Promise<boolean> | null = null;

export function daemonLaunchSpec(
  env: DaemonEnv = process.env,
  execPath = process.execPath,
): { file: string; args: string[] } | null {
  if (env.FLEETLENS_WEB_START_DAEMON === "0") return null;
  const cli = env.FLEETLENS_CLI_BIN;
  if (!cli) return null;
  return { file: execPath, args: [cli, "daemon", "start"] };
}

async function runDaemonStart(file: string, args: string[]): Promise<void> {
  await execFileAsync(file, args, { timeout: 10_000 });
}

/** Opening any dashboard page reconnects /api/events, making the local web
 *  server an idempotent daemon recovery path independent of the menu bar. */
export function ensureUsageDaemon(
  run: DaemonRunner = runDaemonStart,
  env: DaemonEnv = process.env,
): Promise<boolean> {
  const spec = daemonLaunchSpec(env);
  if (!spec) return Promise.resolve(false);
  if (startInFlight) return startInFlight;

  startInFlight = run(spec.file, spec.args)
    .then(() => true)
    .catch((error: unknown) => {
      console.warn(`[events] daemon recovery failed: ${(error as Error).message}`);
      return false;
    })
    .finally(() => {
      startInFlight = null;
    });
  return startInFlight;
}
