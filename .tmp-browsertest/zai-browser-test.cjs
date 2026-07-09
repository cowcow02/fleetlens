const { chromium } = require("playwright");

const BASE = "http://localhost:3137";
const KEY = require("fs").readFileSync("/tmp/zai-key.txt", "utf8").trim();
const BAD = "totally-bogus-key-999";
function usageText() {
  const p = process.env.HOME + "/.cclens/usage.jsonl";
  return require("fs").existsSync(p) ? require("fs").readFileSync(p, "utf8") : "";
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok: " + msg);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fails = [];
  page.on("console", (m) => { if (m.type() === "error") fails.push(m.text()); });

  try {
    console.log("[load /settings]");
    await page.goto(BASE + "/settings", { waitUntil: "domcontentloaded" });
    await page.getByText("Z.ai API key", { exact: false }).first().waitFor({ timeout: 10000 });
    assert(true, "Settings shows Z.ai API key section");

    const input = page.getByPlaceholder("Paste your API key");
    const saveBtn = page.getByRole("button", { name: "Save" }).first();

    console.log("[A] invalid key rejected, not saved");
    await input.fill(BAD);
    await saveBtn.click();
    // The error text is transient (SSE refresh can re-render), so assert on
    // the stable side effect: the key is never persisted.
    await page.waitForTimeout(4000);
    // (Error text is transient under SSE refresh; the stable proof is the
    // side effect below — the bad key was never persisted.)
    const bodyTxt = await page.locator("body").innerText();
    console.log("  page shows: " + (bodyTxt.match(/Invalid Z\.ai API key[^\n]*/i)?.[0] ?? "(error text not visible at assert time)"));
    const creds = require("fs").existsSync(process.env.HOME + "/.cclens/credentials.json")
      ? require("fs").readFileSync(process.env.HOME + "/.cclens/credentials.json", "utf8")
      : "";
    assert(!creds.includes(BAD), "credentials.json does NOT contain the bad key");
    assert(/"agent":"zai"/.test(usageText()) === false, "usage.jsonl has NO zai line after invalid key");
    console.log("  credentials.json: " + (creds.trim() || "(absent)"));

    console.log("[B] valid key saved + immediate snapshot");
    await input.fill(KEY);
    await saveBtn.click();
    await page.getByText("Z.ai API key saved.").waitFor({ timeout: 10000 });
    assert(true, "success message 'Z.ai API key saved.' shown");
    const creds2 = require("fs").readFileSync(process.env.HOME + "/.cclens/credentials.json", "utf8");
    assert(creds2.includes(KEY.slice(0, 10)), "credentials.json now holds the valid key");
    const usage = usageText();
    assert(/"agent":"zai"/.test(usage), "usage.jsonl has an immediate zai line");

    console.log("[B] /usage shows zai tab");
    await page.goto(BASE + "/usage", { waitUntil: "domcontentloaded" });
    const zaiTab = page.locator('a[href="/usage?agent=zai"]');
    await zaiTab.waitFor({ timeout: 10000 });
    assert(true, "/usage renders a zai tab");

    console.log("[A2] remove key -> tab gone");
    await page.goto(BASE + "/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Remove key" }).first().click();
    await page.getByText("Z.ai API key removed.").waitFor({ timeout: 10000 });
    assert(true, "'Z.ai API key removed.' shown");
    const usage2 = usageText();
    assert(!/"agent":"zai"/.test(usage2), "usage.jsonl zai line pruned after removal");
    await page.goto(BASE + "/usage", { waitUntil: "domcontentloaded" });
    const zaiTab2 = page.locator('a[href="/usage?agent=zai"]');
    assert((await zaiTab2.count()) === 0, "/usage no longer shows zai tab");

    if (fails.length) {
      console.log("\nPAGE CONSOLE ERRORS:\n" + fails.join("\n"));
    } else {
      console.log("\nNO page console errors.");
    }
    console.log("\nALL BROWSER ASSERTIONS PASSED");
  } catch (e) {
    console.error("\nBROWSER TEST FAILED: " + e.message);
    await page.screenshot({ path: "/Users/cowcow02/Repo/claude-lens/.tmp-browsertest/fail.png" }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
