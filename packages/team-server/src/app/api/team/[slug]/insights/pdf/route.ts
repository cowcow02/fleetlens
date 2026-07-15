import { NextRequest, NextResponse } from "next/server";
import type { Browser, BrowserContextOptions, LaunchOptions } from "playwright";
import { requireTeamMembership, requireGroupManager } from "../../../../../../lib/route-helpers";
import { mintRenderToken } from "../../../../../../lib/render-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "fleetlens_session";

/**
 * Loopback base URL for the headless PDF capture.
 *
 * Never use the public BASE_URL / Host here. Production sets BASE_URL to the
 * external HTTPS origin (Caddy / Cloud Run). Navigating Playwright at that
 * address from inside the container routinely fails (DNS hairpin, TLS,
 * firewall) and Secure cookies for the public host don't attach to an
 * internal render. Hitting the process on 127.0.0.1 keeps capture self-contained.
 */
type EnvLike = Record<string, string | undefined>;

export function internalRenderBaseUrl(env: EnvLike = process.env): string {
  const port = env.PORT || "3322";
  return `http://127.0.0.1:${port}`;
}

export function chromiumLaunchOptions(env: EnvLike = process.env): LaunchOptions {
  const executablePath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  // Container images run as root without a user namespace; Chromium refuses
  // that without --no-sandbox. --disable-dev-shm-usage avoids /dev/shm OOMs
  // common in small Docker/Cloud Run instances.
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
  return {
    headless: true,
    executablePath,
    args,
  };
}

async function handle(req: NextRequest, slugParam: Promise<{ slug: string }>) {
  const { slug } = await slugParam;
  const auth = await requireTeamMembership(req, slug, { bySlug: true });
  if (auth instanceof NextResponse) return auth;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Insights are group-scoped only — a group is required, and access is guarded
  // to admin/staff or the group's manager here (404) so unauthorized requests
  // fail fast instead of timing out the headless render against /report's
  // not-found page.
  const group = req.nextUrl.searchParams.get("group");
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const week = req.nextUrl.searchParams.get("week");
  const g = await requireGroupManager(auth, group);
  if (g instanceof NextResponse) return g;
  const qs = new URLSearchParams({ group });
  if (week) qs.set("week", week);
  qs.set("render", mintRenderToken({ slug, group, week: week ?? undefined }));
  const reportPath = `/report/${encodeURIComponent(slug)}?${qs}`;
  const origin = internalRenderBaseUrl();
  const dashUrl = `${origin}${reportPath}`;

  // A4 portrait at 96dpi: 794 × 1123 px (210 × 297 mm). Match the viewport
  // exactly so there's no mismatch between layout width and PDF page width.
  const ctxOpts: BrowserContextOptions = {
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 2,
  };

  // Dynamic import so a missing/broken playwright package surfaces as a
  // handled 500 with a useful body, not Next's generic "Internal Server Error"
  // from a failed top-level module load (what production showed when NFT
  // omitted playwright-core/browsers.json).
  let browser: Browser | undefined;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch(chromiumLaunchOptions());
  } catch (err) {
    console.error("[pdf] chromium launch failed", err);
    return new Response(
      `PDF generation failed: Chromium could not start (${err instanceof Error ? err.message : String(err)}). ` +
        `Ensure the image ships a complete playwright-core package (browsers.json) and Chromium binaries.`,
      { status: 500 },
    );
  }

  try {
    const context = await browser.newContext(ctxOpts);
    // Prefer `url` over domain/secure so the session cookie is scoped to the
    // loopback origin we actually navigate — not the public BASE_URL host.
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: token,
        url: origin,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    const page = await context.newPage();
    const response = await page.goto(dashUrl, { waitUntil: "networkidle", timeout: 30_000 });
    if (!response || !response.ok()) {
      const status = response?.status() ?? "no-response";
      throw new Error(`report page returned ${status} for ${reportPath}`);
    }
    await page.waitForSelector(".builder-grid", { timeout: 15_000 });
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll(".builder-widget, .builder-extra, .builder-divider");
        if (items.length === 0) return false;
        return Array.from(items).every((el) => (el as HTMLElement).getBoundingClientRect().height > 0);
      },
      undefined,
      { timeout: 10_000 },
    );
    // Strip scrollbars + force the page background to extend to every edge so
    // the PDF capture has no gray gutter on the right (which is the browser's
    // default canvas color showing through where the scrollbar would have been).
    await page.addStyleTag({
      content: `
        html, body, .report-shell {
          background: #f3efe5 !important;
          margin: 0 !important;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        html::-webkit-scrollbar, body::-webkit-scrollbar, .report-shell::-webkit-scrollbar, *::-webkit-scrollbar {
          display: none !important; width: 0 !important; height: 0 !important;
        }
      `,
    });

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: false,
      format: "A4",
      landscape: false,
      // Zero PDF margins — Playwright leaves those edges WHITE which causes a
      // visible strip beside the cream-coloured content. Move the breathing
      // room into the .report-shell padding instead.
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
    });

    const today = new Date().toISOString().slice(0, 10);
    const filename = `${slug}-${group}-insight-report-${today}.pdf`;
    if (process.env.NODE_ENV !== "production") {
      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`/tmp/last-pdf-${slug}-${group}.pdf`, Buffer.from(pdf));
      } catch {
        // ignore — dev convenience only
      }
    }
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[pdf] generation failed", err);
    return new Response(`PDF generation failed: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return handle(req, ctx.params);
}
