import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readMenubarState } from "@/lib/menubar-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

type Action = "install" | "open" | "uninstall";

function isValidAction(v: unknown): v is Action {
  return v === "install" || v === "open" || v === "uninstall";
}

export async function GET(): Promise<Response> {
  return Response.json(readMenubarState());
}

export async function POST(req: Request): Promise<Response> {
  const bin = process.env.FLEETLENS_CLI_BIN;
  if (!bin) {
    return Response.json(
      {
        error:
          "The menu bar widget needs the dashboard to run via the fleetlens CLI. Run `fleetlens menubar install` in your terminal instead.",
      },
      { status: 503 },
    );
  }
  const state = readMenubarState();
  if (!state.supported) {
    return Response.json(
      { error: "The menu bar widget is a native macOS app and is macOS-only." },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  if (!isValidAction(action)) {
    return Response.json({ error: "Expected { action: \"install\" | \"open\" | \"uninstall\" }." }, { status: 400 });
  }

  // Spawn the CLI rather than duplicating install logic — the CLI owns path
  // resolution, the ~/Applications copy, login-item registration, and clean
  // teardown. Mirrors /api/team/autostart exactly.
  //
  // install uses --no-login so a web-triggered install doesn't surprise the
  // user with a System Events Automation prompt; login-at-boot stays available
  // via the terminal command.
  const args =
    action === "install"
      ? ["menubar", "install", "--no-login"]
      : ["menubar", action];

  try {
    await execFileAsync(process.execPath, [bin, ...args], { timeout: 20_000 });
  } catch (err) {
    return Response.json(
      { error: `menubar ${action} failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, action, ...readMenubarState() });
}
