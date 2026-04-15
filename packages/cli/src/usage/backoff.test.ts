import { describe, it, expect } from "vitest";
import { nextIntervalMs, BASE_INTERVAL_MS, MAX_INTERVAL_MS } from "./backoff.js";

describe("nextIntervalMs", () => {
  it("resets to base on success", () => {
    expect(nextIntervalMs(BASE_INTERVAL_MS, "success")).toBe(BASE_INTERVAL_MS);
    expect(nextIntervalMs(MAX_INTERVAL_MS, "success")).toBe(BASE_INTERVAL_MS);
  });

  it("leaves interval unchanged on network error", () => {
    expect(nextIntervalMs(BASE_INTERVAL_MS, "network")).toBe(BASE_INTERVAL_MS);
    expect(nextIntervalMs(BASE_INTERVAL_MS * 4, "network")).toBe(BASE_INTERVAL_MS * 4);
  });

  it("doubles on auth error", () => {
    expect(nextIntervalMs(BASE_INTERVAL_MS, "auth")).toBe(BASE_INTERVAL_MS * 2);
    expect(nextIntervalMs(BASE_INTERVAL_MS * 2, "auth")).toBe(BASE_INTERVAL_MS * 4);
  });

  it("caps at the max interval", () => {
    expect(nextIntervalMs(MAX_INTERVAL_MS, "auth")).toBe(MAX_INTERVAL_MS);
    expect(nextIntervalMs(MAX_INTERVAL_MS / 2 + 1, "auth")).toBe(MAX_INTERVAL_MS);
  });

  it("climbs from base to cap in a predictable number of steps", () => {
    let interval = BASE_INTERVAL_MS;
    const steps: number[] = [interval];
    for (let i = 0; i < 10 && interval < MAX_INTERVAL_MS; i++) {
      interval = nextIntervalMs(interval, "auth");
      steps.push(interval);
    }
    expect(steps).toEqual([
      5 * 60_000,
      10 * 60_000,
      20 * 60_000,
      40 * 60_000,
      60 * 60_000,
    ]);
  });
});
