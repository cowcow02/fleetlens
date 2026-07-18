import { describe, it, expect } from "vitest";
import { ServerWatchdog } from "../src/watchdog.js";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function failTimes(dog: ServerWatchdog, n: number, startMs: number, stepMs = MIN) {
  let verdict;
  for (let i = 0; i < n; i++) verdict = dog.onProbe(false, startMs + i * stepMs);
  return verdict!;
}

describe("ServerWatchdog", () => {
  it("stays ok while probes succeed", () => {
    const dog = new ServerWatchdog();
    expect(dog.onProbe(true, T0)).toBe("ok");
    expect(dog.onProbe(true, T0 + MIN)).toBe("ok");
  });

  it("requires 3 consecutive failures before ordering a restart", () => {
    const dog = new ServerWatchdog();
    expect(dog.onProbe(false, T0)).toBe("failing");
    expect(dog.onProbe(false, T0 + MIN)).toBe("failing");
    expect(dog.onProbe(false, T0 + 2 * MIN)).toBe("restart");
  });

  it("a successful probe resets the consecutive-failure count", () => {
    const dog = new ServerWatchdog();
    dog.onProbe(false, T0);
    dog.onProbe(false, T0 + MIN);
    expect(dog.onProbe(true, T0 + 2 * MIN)).toBe("ok");
    expect(dog.onProbe(false, T0 + 3 * MIN)).toBe("failing");
    expect(dog.onProbe(false, T0 + 4 * MIN)).toBe("failing");
    expect(dog.onProbe(false, T0 + 5 * MIN)).toBe("restart");
  });

  it("resets the failure count after a restart so the fresh server gets a full grace run", () => {
    const dog = new ServerWatchdog();
    failTimes(dog, 3, T0);
    expect(dog.onProbe(false, T0 + 3 * MIN)).toBe("failing");
  });

  it("gives up after 3 restarts within the hour window", () => {
    const dog = new ServerWatchdog();
    expect(failTimes(dog, 3, T0)).toBe("restart");
    expect(failTimes(dog, 3, T0 + 3 * MIN)).toBe("restart");
    expect(failTimes(dog, 3, T0 + 6 * MIN)).toBe("restart");
    expect(failTimes(dog, 3, T0 + 9 * MIN)).toBe("gave-up");
    expect(dog.onProbe(false, T0 + 13 * MIN)).toBe("gave-up");
  });

  it("re-arms once earlier restarts age out of the window", () => {
    const dog = new ServerWatchdog();
    failTimes(dog, 3, T0);
    failTimes(dog, 3, T0 + 3 * MIN);
    failTimes(dog, 3, T0 + 6 * MIN);
    expect(failTimes(dog, 3, T0 + 9 * MIN)).toBe("gave-up");
    const later = T0 + 63 * MIN; // first restart (T0+2min) now outside the 60-min window
    expect(dog.onProbe(false, later)).toBe("restart");
  });

  it("recovery after give-up returns to ok and normal thresholds", () => {
    const dog = new ServerWatchdog();
    failTimes(dog, 3, T0);
    failTimes(dog, 3, T0 + 3 * MIN);
    failTimes(dog, 3, T0 + 6 * MIN);
    failTimes(dog, 3, T0 + 9 * MIN); // gave-up
    expect(dog.onProbe(true, T0 + 12 * MIN)).toBe("ok");
    expect(dog.onProbe(false, T0 + 13 * MIN)).toBe("failing");
  });
});
