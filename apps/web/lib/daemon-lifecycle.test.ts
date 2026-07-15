import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonLaunchSpec, ensureUsageDaemon } from "./daemon-lifecycle";

afterEach(() => vi.restoreAllMocks());

describe("daemonLaunchSpec", () => {
  it("launches daemon start through the persisted CLI path", () => {
    expect(
      daemonLaunchSpec({ FLEETLENS_CLI_BIN: "/opt/fleetlens/dist/index.js" }, "/usr/bin/node"),
    ).toEqual({
      file: "/usr/bin/node",
      args: ["/opt/fleetlens/dist/index.js", "daemon", "start"],
    });
  });

  it("skips dev servers without a CLI and explicit --no-daemon servers", () => {
    expect(daemonLaunchSpec({}, "/usr/bin/node")).toBeNull();
    expect(
      daemonLaunchSpec(
        {
          FLEETLENS_CLI_BIN: "/opt/fleetlens/dist/index.js",
          FLEETLENS_WEB_START_DAEMON: "0",
        },
        "/usr/bin/node",
      ),
    ).toBeNull();
  });
});

describe("ensureUsageDaemon", () => {
  it("coalesces simultaneous dashboard connections", async () => {
    let finish!: () => void;
    const run = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const env = { FLEETLENS_CLI_BIN: "/opt/fleetlens/dist/index.js" };

    const first = ensureUsageDaemon(run, env);
    const second = ensureUsageDaemon(run, env);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(process.execPath, [
      "/opt/fleetlens/dist/index.js",
      "daemon",
      "start",
    ]);
    finish();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it("returns false when daemon start fails and allows a retry", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("spawn failed")).mockResolvedValueOnce(undefined);
    const env = { FLEETLENS_CLI_BIN: "/opt/fleetlens/dist/index.js" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(ensureUsageDaemon(run, env)).resolves.toBe(false);
    await expect(ensureUsageDaemon(run, env)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("[events] daemon recovery failed: spawn failed");
  });
});
