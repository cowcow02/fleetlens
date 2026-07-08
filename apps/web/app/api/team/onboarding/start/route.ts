import { spawn } from "node:child_process";
import { readTeamConfig, writeTeamConfig } from "@/lib/team-config";
import { SyncProjectsSchema } from "@/lib/sync-projects-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A full-history first sync can legitimately run for minutes; kill only on
// silence, not on total duration.
const IDLE_TIMEOUT_MS = 180_000;

export async function POST(req: Request): Promise<Response> {
  const bin = process.env.FLEETLENS_CLI_BIN;
  if (!bin) {
    return Response.json(
      { error: "Onboarding sync requires the dashboard to be running via the fleetlens CLI. Run 'fleetlens team sync' in your terminal instead." },
      { status: 503 },
    );
  }
  const config = readTeamConfig();
  if (!config) return Response.json({ error: "Not paired with a team." }, { status: 409 });
  const parsed = SyncProjectsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  // Persist selection + clear the gate BEFORE spawning: if the browser
  // disconnects mid-sync the daemon completes the push on its next tick.
  const { setupPending: _cleared, ...rest } = config;
  writeTeamConfig({ ...rest, syncProjects: parsed.data });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream already closed by the client — child keeps running on purpose.
        }
      };
      const child = spawn(process.execPath, [bin, "team", "sync", "--progress-json"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      let buffer = "";
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => child.kill("SIGKILL"), IDLE_TIMEOUT_MS);
      };
      resetIdle();
      child.stdout.on("data", (buf: Buffer) => {
        resetIdle();
        buffer += buf.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            send("progress", JSON.parse(line));
          } catch {
            send("progress", { type: "log", line });
          }
        }
      });
      child.stderr.on("data", () => resetIdle());
      child.on("close", (code) => {
        if (idleTimer) clearTimeout(idleTimer);
        // Flush a trailing partial line (idle-timer SIGKILL can cut mid-write)
        // so the progress list doesn't silently end a row early.
        if (buffer.trim()) {
          try {
            send("progress", JSON.parse(buffer));
          } catch {
            send("progress", { type: "log", line: buffer });
          }
        }
        send("done", { exitCode: code });
        try { controller.close(); } catch {}
      });
      child.on("error", (err) => {
        if (idleTimer) clearTimeout(idleTimer);
        send("progress", { type: "error", message: `Failed to spawn CLI: ${err.message}` });
        send("done", { exitCode: null });
        try { controller.close(); } catch {}
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
