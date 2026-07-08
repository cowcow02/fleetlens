import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readAutostartState } from "@/lib/autostart-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function GET(): Promise<Response> {
  return Response.json(readAutostartState());
}

export async function PUT(req: Request): Promise<Response> {
  const bin = process.env.FLEETLENS_CLI_BIN;
  if (!bin) {
    return Response.json(
      { error: "Autostart needs the dashboard to run via the fleetlens CLI. Use 'fleetlens autostart install' in your terminal instead." },
      { status: 503 },
    );
  }
  const state = readAutostartState();
  if (!state.supported) {
    return Response.json({ error: "Auto-start uses a macOS LaunchAgent and is macOS-only for now." }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== "boolean") {
    return Response.json({ error: "Expected { enabled: boolean }." }, { status: 400 });
  }
  // Spawn the CLI rather than duplicating plist logic — the CLI bakes its own
  // absolute node/script paths into the LaunchAgent and keeps the opt-out
  // flag semantics in one place.
  try {
    await execFileAsync(process.execPath, [bin, "autostart", body.enabled ? "install" : "uninstall"], {
      timeout: 15_000,
    });
  } catch (err) {
    return Response.json({ error: `autostart ${body.enabled ? "install" : "uninstall"} failed: ${(err as Error).message}` }, { status: 500 });
  }
  return Response.json({ ok: true, ...readAutostartState() });
}
