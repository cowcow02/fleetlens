import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { chromium, type BrowserContextOptions } from "playwright";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "fleetlens_session";

function baseUrl(req: NextRequest): string {
  const env = process.env.BASE_URL;
  if (env) return env.replace(/\/$/, "");
  const host = req.headers.get("host") ?? "localhost";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function handle(req: NextRequest, slugParam: Promise<{ slug: string }>, builderState: string | null) {
  const { slug } = await slugParam;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return new Response("Unauthorized", { status: 401 });

  const pool = getPool();
  const session = await validateSession(token, pool);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return new Response("Team not found", { status: 404 });
  const teamId = teamRes.rows[0].id;
  const membership = session.memberships.find((m) => m.team_id === teamId);
  if (!membership) return new Response("Forbidden", { status: 403 });

  const dashUrl = `${baseUrl(req)}/report/${encodeURIComponent(slug)}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const cookieDomain = new URL(baseUrl(req)).hostname;
    // A4 portrait at 96dpi: 794 × 1123 px (210 × 297 mm). Match the viewport
    // exactly so there's no mismatch between layout width and PDF page width.
    const ctxOpts: BrowserContextOptions = {
      viewport: { width: 794, height: 1123 },
      deviceScaleFactor: 2,
    };
    const context = await browser.newContext(ctxOpts);
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, domain: cookieDomain, path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
    ]);

    const page = await context.newPage();
    // Seed the user's localStorage layout before the dashboard hydrates.
    if (builderState) {
      const storageKey = `fleetlens-builder-v7:${slug}`;
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
    await page.waitForTimeout(400);
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
    const filename = `${slug}-insight-report-${today}.pdf`;
    // Dev-only: mirror to /tmp so the PDF endpoint result is inspectable from
    // tooling that can't read the user's Downloads folder.
    if (process.env.NODE_ENV !== "production") {
      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`/tmp/last-pdf-${slug}.pdf`, Buffer.from(pdf));
      } catch {
        // ignore
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
  return handle(req, ctx.params, null);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  let state: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body && typeof body.state === "string" && body.state.length < 200_000) state = body.state;
    } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const raw = form.get("state");
      if (typeof raw === "string" && raw.length < 200_000) state = raw;
    }
  } catch {
    // ignore — no state provided
  }
  return handle(req, ctx.params, state);
}
