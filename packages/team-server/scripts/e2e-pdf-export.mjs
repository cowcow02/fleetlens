/**
 * End-to-end check: login → group insights → Export PDF download.
 *
 * Usage (server already running on :3322, QA seed applied):
 *   node packages/team-server/scripts/e2e-pdf-export.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3322";
const EMAIL = process.env.E2E_EMAIL || "admin@qa.local";
const PASSWORD = process.env.E2E_PASSWORD || "password1234";
const GROUP = process.env.E2E_GROUP || "platform";
const TEAM = process.env.E2E_TEAM || "acme";

const browser = await chromium.launch({
  headless: true,
  // Match the PDF route's container-safe flags so this script also works
  // under root/CI sandboxes.
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

try {
  console.log(`→ ${BASE}/login`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"], input[type="email"]', EMAIL);
  await page.fill('input[name="password"], input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/team\//, { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log("✓ logged in →", page.url());

  const insightsUrl = `${BASE}/team/${TEAM}/groups/${GROUP}/insights?mock=1`;
  console.log(`→ ${insightsUrl}`);
  await page.goto(insightsUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".builder-grid, a.btn", { timeout: 20_000 });

  const pdfLink = page.locator('a.btn:has-text("Export PDF")');
  await pdfLink.waitFor({ state: "visible", timeout: 10_000 });
  const href = await pdfLink.getAttribute("href");
  console.log("✓ Export PDF href:", href);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    pdfLink.click(),
  ]);
  const suggested = download.suggestedFilename();
  const path = `/tmp/e2e-${suggested || "insight.pdf"}`;
  await download.saveAs(path);
  const fail = await download.failure();
  if (fail) throw new Error(`download failed: ${fail}`);

  const { readFileSync } = await import("node:fs");
  const buf = readFileSync(path);
  if (buf.length < 1000 || buf.subarray(0, 4).toString() !== "%PDF") {
    writeFileSync("/tmp/e2e-pdf-export-fail.bin", buf);
    throw new Error(`not a PDF (size=${buf.length}, head=${buf.subarray(0, 40).toString()})`);
  }
  console.log(`✓ PDF download ok: ${path} (${buf.length} bytes, ${suggested})`);
  process.exitCode = 0;
} catch (err) {
  console.error("✗ e2e failed:", err);
  try {
    await page.screenshot({ path: "/tmp/e2e-pdf-export-fail.png", fullPage: true });
    console.error("  screenshot → /tmp/e2e-pdf-export-fail.png");
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
}
