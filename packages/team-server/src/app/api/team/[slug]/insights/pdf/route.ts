import { NextRequest, NextResponse } from "next/server";
import { chromium, type BrowserContextOptions } from "playwright";
import { requireTeamMembership, requireGroupManager } from "../../../../../../lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "fleetlens_session";
const BUILDER_STATE_KEY_PREFIX = "fleetlens-builder-v7:";
const MAX_STATE_BYTES = 200_000;

function baseUrl(req: NextRequest): string {
  const env = process.env.BASE_URL;
  if (env) return env.replace(/\/$/, "");
  const host = req.headers.get("host") ?? "localhost";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function handle(
  req: NextRequest,
  slugParam: Promise<{ slug: string }>,
  builderState: string | null,
  source: "live" | "preview",
) {
  const { slug } = await slugParam;
  const auth = await requireTeamMembership(req, slug, { bySlug: true });
  if (auth instanceof NextResponse) return auth;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-group export: guard group access to admin/staff or the group's manager
  // here (404) so unauthorized requests fail fast instead of timing out the
  // headless render against /report's not-found page.
  const group = req.nextUrl.searchParams.get("group");
  const coaching = req.nextUrl.searchParams.get("coaching") === "1";
  if (group) {
    const g = await requireGroupManager(auth, group);
    if (g instanceof NextResponse) return g;
  }
  const reportQuery = group
    ? `?group=${encodeURIComponent(group)}${coaching ? "&coaching=1" : ""}`
    : source === "preview"
      ? "?source=preview"
      : "";
  const reportPath = `/report/${encodeURIComponent(slug)}${reportQuery}`;
  const dashUrl = `${baseUrl(req)}${reportPath}`;
  const cookieDomain = new URL(baseUrl(req)).hostname;
  const cookieSecure = baseUrl(req).startsWith("https:");

  // A4 portrait at 96dpi: 794 × 1123 px (210 × 297 mm). Match the viewport
  // exactly so there's no mismatch between layout width and PDF page width.
  const ctxOpts: BrowserContextOptions = {
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 2,
  };

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(ctxOpts);
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, domain: cookieDomain, path: "/", httpOnly: true, secure: cookieSecure, sameSite: "Lax" },
    ]);

    const page = await context.newPage();
    // Must seed localStorage BEFORE goto — otherwise React hydrates with the
    // starter preset and never re-reads the storage entry.
    if (builderState) {
      const storageKey = `${BUILDER_STATE_KEY_PREFIX}${slug}`;
      await page.addInitScript(
        ([key, value]) => {
          try { window.localStorage.setItem(key, value); } catch {}
        },
        [storageKey, builderState],
      );
    }
    await page.goto(dashUrl, { waitUntil: "networkidle", timeout: 30_000 });
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
    const filename = `${slug}${group ? `-${group}` : ""}-insight-report-${today}.pdf`;
    if (process.env.NODE_ENV !== "production") {
      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`/tmp/last-pdf-${slug}${group ? `-${group}` : ""}.pdf`, Buffer.from(pdf));
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

function sourceFromQuery(req: NextRequest): "live" | "preview" {
  return req.nextUrl.searchParams.get("source") === "preview" ? "preview" : "live";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return handle(req, ctx.params, null, sourceFromQuery(req));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  let state: string | null = null;
  let bodySource: "live" | "preview" | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body && typeof body.state === "string" && body.state.length < MAX_STATE_BYTES) state = body.state;
      if (body && (body.source === "live" || body.source === "preview")) bodySource = body.source;
    } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const raw = form.get("state");
      if (typeof raw === "string" && raw.length < MAX_STATE_BYTES) state = raw;
      const rawSource = form.get("source");
      if (rawSource === "live" || rawSource === "preview") bodySource = rawSource;
    }
  } catch {
    // ignore — no state provided, route will render starter layout
  }
  return handle(req, ctx.params, state, bodySource ?? sourceFromQuery(req));
}
