import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  readWeekDigest, readMonthDigest,
  getCurrentWeekDigestFromCache, getCurrentMonthDigestFromCache,
} from "@claude-lens/entries/node";
import { currentWeekMonday, currentYearMonth } from "@/lib/entries";
import { findChrome } from "@/lib/find-chrome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = /^(week-(\d{4}-\d{2}-\d{2})|month-(\d{4}-\d{2}))$/;

const RENDER_TIMEOUT_MS = 25_000;
const STABILITY_MS = 600;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const m = KEY.exec(key);
  if (!m) {
    return jsonError(400, `Invalid key: ${key}`);
  }

  // Pre-check the digest exists in whichever source the /print page would
  // read from. Without this, Chrome happily captures Next.js's 404 page as
  // a "successful" PDF, and current-period digests that have aged out of
  // the in-memory TTL would yield a broken download instead of a clear
  // error.
  if (!digestExists(m)) {
    return jsonError(
      404,
      "Digest not found. If this is the current week or month, the in-memory cache may have expired — reload the page and re-generate.",
    );
  }

  const chrome = await findChrome();
  if (!chrome) {
    return jsonError(
      500,
      "Could not find Chrome / Chromium. Install Google Chrome, or set FLEETLENS_CHROME_PATH.",
    );
  }

  const origin = new URL(req.url).origin;
  // Headless Chrome won't carry the user's session cookies, so forward the
  // current theme via query param. Middleware turns it into a header that
  // the root layout applies to <html data-theme>.
  const theme = parseThemeCookie(req.headers.get("cookie"));
  const targetUrl = theme
    ? `${origin}/print/${key}?theme=${theme}`
    : `${origin}/print/${key}`;

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

function digestExists(match: RegExpExecArray): boolean {
  const monday = match[2];
  const yearMonth = match[3];
  if (monday) {
    if (monday === currentWeekMonday()) {
      return !!(getCurrentWeekDigestFromCache(monday, Date.now()) ?? readWeekDigest(monday));
    }
    return !!readWeekDigest(monday);
  }
  if (yearMonth) {
    if (yearMonth === currentYearMonth()) {
      return !!(getCurrentMonthDigestFromCache(yearMonth, Date.now()) ?? readMonthDigest(yearMonth));
    }
    return !!readMonthDigest(yearMonth);
  }
  return false;
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
  // --no-sandbox is required on Linux containers / CI without user namespaces
  // (Chrome can't drop privileges otherwise), but it's a security weakening
  // that's not needed on macOS or Windows desktop Chrome. Opt-in via env on
  // the systems that need it.
  const noSandbox = process.env.FLEETLENS_CHROME_NO_SANDBOX === "1"
    || process.platform === "linux";
  const args = [
    "--headless=new",
    "--disable-gpu",
    ...(noSandbox ? ["--no-sandbox"] : []),
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

  let earlyExit: number | null = null;
  const proc = spawn(chrome, args, {
    stdio: "ignore",
    detached: true,
  });
  proc.on("exit", (code) => { earlyExit = code; });
  proc.unref();

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let lastSize = -1;
  let stableSince = 0;
  let lastErr: NodeJS.ErrnoException | null = null;

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

// On Unix the negative PID kills the whole process group (Chrome spawns
// helper processes for GPU, network, renderer). On Windows process.kill(-pid)
// throws ESRCH — the swallowed exception is intentional, and the fallback
// kill below at least reaps the root Chrome process.
function killGroup(pid: number | undefined): void {
  if (!pid) return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* group already gone, or Windows */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
}

function parseThemeCookie(header: string | null): "light" | "dark" | null {
  if (!header) return null;
  const m = /(?:^|;\s*)claude-lens-theme=(light|dark)/.exec(header);
  return m ? (m[1] as "light" | "dark") : null;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
