import { describe, expect, it } from "vitest";
import { resolveNodeBin } from "../src/node-bin.js";

const major = Number(process.versions.node.split(".")[0]);
const nvm = "/home/me/.nvm/versions/node";
const present = (...paths: string[]) => (p: string) => paths.includes(p);
const noNvm = () => {
  throw new Error("ENOENT");
};

describe("resolveNodeBin", () => {
  it("keeps the running Node while it still exists", () => {
    expect(
      resolveNodeBin({
        execPath: "/opt/node/bin/node",
        env: { PATH: "/usr/bin" },
        exists: present("/opt/node/bin/node", "/usr/bin/node"),
        listDir: noNvm,
      }),
    ).toBe("/opt/node/bin/node");
  });

  it("falls back to the first live node on PATH, skipping the removed nvm dir", () => {
    expect(
      resolveNodeBin({
        execPath: `${nvm}/v${major}.17.0/bin/node`,
        env: { PATH: `${nvm}/v${major}.17.0/bin:/home/me/.local/bin:/usr/bin` },
        exists: present("/home/me/.local/bin/node", "/opt/homebrew/bin/node"),
        listDir: noNvm,
      }),
    ).toBe("/home/me/.local/bin/node");
  });

  // launchd's PATH is /usr/bin:/bin:/usr/sbin:/sbin — no node on it.
  it("picks the newest same-major nvm install by numeric version when PATH has none", () => {
    expect(
      resolveNodeBin({
        execPath: `${nvm}/v${major}.17.0/bin/node`,
        env: { PATH: "/usr/bin:/bin", NVM_DIR: "/home/me/.nvm" },
        exists: present(
          `${nvm}/v${major}.9.0/bin/node`,
          `${nvm}/v${major}.10.1/bin/node`,
          `${nvm}/v${major + 1}.0.0/bin/node`,
          "/opt/homebrew/bin/node",
        ),
        listDir: () => [`v${major}.9.0`, `v${major}.10.1`, `v${major + 1}.0.0`, `v${major}.17.0`],
      }),
    ).toBe(`${nvm}/v${major}.10.1/bin/node`);
  });

  it("falls back to Homebrew without nvm, and to execPath when nothing exists", () => {
    const base = { execPath: "/gone/bin/node", env: { PATH: "/usr/bin" }, listDir: noNvm };
    expect(resolveNodeBin({ ...base, exists: present("/opt/homebrew/bin/node") })).toBe(
      "/opt/homebrew/bin/node",
    );
    expect(resolveNodeBin({ ...base, exists: present() })).toBe("/gone/bin/node");
  });
});
