import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 30_000;

type SyncResponse = {
  ok: boolean;
  lines: string[];
  exitCode: number | null;
  error?: string;
};

export async function POST(): Promise<Response> {
  const bin = process.env.FLEETLENS_CLI_BIN;
  if (!bin) {
    return Response.json(
      {
        ok: false,
        lines: [],
        exitCode: null,
        error:
          "Force sync is only available when the dashboard is running via the fleetlens CLI " +
          "(FLEETLENS_CLI_BIN env var not set).",
      } satisfies SyncResponse,
      { status: 503 },
    );
  }

  const result = await runSync(bin);
  const status = result.ok ? 200 : 500;
  return Response.json(result, { status });
}

function runSync(bin: string): Promise<SyncResponse> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, "team", "sync"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const lines: string[] = [];
    let timedOut = false;

    const onChunk = (buf: Buffer) => {
      for (const line of buf.toString("utf8").split("\n")) {
        if (line.length > 0) lines.push(line);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000);
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        lines,
        exitCode: null,
        error: `Failed to spawn CLI: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          lines,
          exitCode: code,
          error: "Sync timed out after 30s — the daemon may be unreachable.",
        });
        return;
      }
      resolve({
        ok: code === 0,
        lines,
        exitCode: code,
        error: code === 0 ? undefined : `CLI exited with code ${code}.`,
      });
    });
  });
}
