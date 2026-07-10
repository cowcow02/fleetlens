import { describe, it, expect } from "vitest";
import {
  internalRenderBaseUrl,
  chromiumLaunchOptions,
} from "../../src/app/api/team/[slug]/insights/pdf/route.js";

describe("internalRenderBaseUrl", () => {
  it("always uses loopback, never the public BASE_URL host", () => {
    const url = internalRenderBaseUrl({ PORT: "3322" });
    expect(url).toBe("http://127.0.0.1:3322");
  });

  it("honours PORT when set", () => {
    expect(internalRenderBaseUrl({ PORT: "4455" })).toBe("http://127.0.0.1:4455");
  });

  it("defaults to 3322", () => {
    expect(internalRenderBaseUrl({})).toBe("http://127.0.0.1:3322");
  });
});

describe("chromiumLaunchOptions", () => {
  it("includes container-safe flags", () => {
    const opts = chromiumLaunchOptions({});
    expect(opts.headless).toBe(true);
    expect(opts.args).toEqual(
      expect.arrayContaining(["--no-sandbox", "--disable-dev-shm-usage"]),
    );
  });

  it("forwards PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", () => {
    const opts = chromiumLaunchOptions({
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/usr/bin/chromium",
    });
    expect(opts.executablePath).toBe("/usr/bin/chromium");
  });
});
