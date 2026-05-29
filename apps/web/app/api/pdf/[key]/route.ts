import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { findChrome } from "@/lib/find-chrome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = /^(week-\d{4}-\d{2}-\d{2}|month-\d{4}-\d{2})$/;

const RENDER_TIMEOUT_MS = 25_000;
const STABILITY_MS = 600;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!KEY.test(key)) {
    return jsonError(400, `Invalid key: ${key}`);
  }

  const chrome = findChrome();
  if (!chrome) {
    return jsonError(
      500,
      "Could not find Chrome / Chromium. Install Google Chrome, or set FLEETLENS_CHROME_PATH.",
    );
  }

  const origin = new URL(req.url).origin;
  const targetUrl = `${origin}/print/${key}`;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fleetlens-pdf-"));
  const tmpPath = path.join(tmpDir, "out.pdf");
  const profileDir = path.join(tmpDir, "profile");

  try {
    await renderToPdf(chrome, targetUrl, tmpPath, profileDir);
    const bytes = await fs.readFile(tmpPath);
    const today = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="fleetlens-${key}-${today}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, `PDF render failed: ${message}`);
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Chrome on macOS produces the PDF in 2–3s but the parent process keeps
// running (GoogleUpdater helpers prevent a clean exit). So instead of waiting
// for the process to close, we poll the output file for stability and kill
// Chrome once it's stable.
async function renderToPdf(
  chrome: string,
  url: string,
  out: string,
  profileDir: string,
): Promise<void> {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    `--user-data-dir=${profileDir}`,
    `--print-to-pdf=${out}`,
    url,
  ];

  const proc = spawn(chrome, args, {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let lastSize = -1;
  let stableSince = 0;
  let lastErr: NodeJS.ErrnoException | null = null;
  let earlyExit: number | null = null;
  proc.on("exit", (code) => { earlyExit = code; });

  while (Date.now() < deadline) {
    await delay(150);
    if (earlyExit !== null && earlyExit !== 0) {
      throw new Error(`Chrome exited early with code ${earlyExit}`);
    }
    let size: number;
    try {
      size = (await fs.stat(out)).size;
    } catch (e) {
      lastErr = e as NodeJS.ErrnoException;
      continue;
    }
    if (size <= 0) continue;
    if (size === lastSize) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= STABILITY_MS) {
        killGroup(proc.pid);
        return;
      }
    } else {
      lastSize = size;
      stableSince = 0;
    }
  }

  killGroup(proc.pid);
  throw new Error(
    `Chrome render timed out after ${RENDER_TIMEOUT_MS / 1000}s` +
    (lastErr ? ` (no PDF file produced: ${lastErr.code})` : ""),
  );
}

function killGroup(pid: number | undefined): void {
  if (!pid) return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* group already gone */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
