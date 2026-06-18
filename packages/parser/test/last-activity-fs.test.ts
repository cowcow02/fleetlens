import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSessions, getSession, clearClaudeCodeCaches } from "../src/claude-code.js";

beforeEach(() => clearClaudeCodeCaches());

const SID = "11111111-2222-3333-4444-555555555555";
const PROJECT_DIR = "-Users-me-Repo-live";
const STALE_TS = "2026-06-02T03:00:01.000Z";
const STALE_MS = Date.parse(STALE_TS);

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n");

/** Write a session whose MAIN transcript is stale (old timestamp + aged mtime),
 *  optionally with a freshly-modified nested subagent / workflow file. Returns
 *  the root and the epoch ms the nested file's mtime was set to. */
async function writeSession(opts: { subagent?: boolean; workflow?: boolean }): Promise<{
  root: string;
  freshMs: number;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "live-fixture-"));
  const projDir = path.join(root, PROJECT_DIR);
  await fs.mkdir(projDir, { recursive: true });
  const mainPath = path.join(projDir, `${SID}.jsonl`);
  await fs.writeFile(
    mainPath,
    jsonl([
      { type: "user", uuid: "u0", parentUuid: null, sessionId: SID, timestamp: STALE_TS, cwd: "/Users/me/Repo/live", message: { role: "user", content: "go" } },
      {
        type: "assistant", uuid: "a1", sessionId: SID, requestId: "rp", timestamp: STALE_TS,
        message: { id: "mp", role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "ok" }] },
      },
    ]),
  );
  // Age the main file's mtime so only a nested file can make it "live".
  const old = new Date(STALE_MS);
  await fs.utimes(mainPath, old, old);

  const freshMs = Date.now();
  const fresh = new Date(freshMs);
  if (opts.subagent) {
    const subDir = path.join(projDir, SID, "subagents");
    await fs.mkdir(subDir, { recursive: true });
    const p = path.join(subDir, "agent-x.jsonl");
    await fs.writeFile(p, jsonl([{ type: "assistant", uuid: "s1", timestamp: STALE_TS, sessionId: SID, message: { id: "ms", role: "assistant", content: [{ type: "text", text: "sub" }] } }]));
    await fs.utimes(p, fresh, fresh);
  }
  if (opts.workflow) {
    const wfDir = path.join(projDir, SID, "workflows");
    await fs.mkdir(wfDir, { recursive: true });
    const p = path.join(wfDir, "wf_x.json");
    await fs.writeFile(p, JSON.stringify({ runId: "wf_x", status: "running", agentCount: 3, startTime: 1, durationMs: 0 }));
    await fs.utimes(p, fresh, fresh);
  }
  return { root, freshMs };
}

describe("lastActivityMs reflects nested background-agent/workflow activity", () => {
  it("falls back to the main transcript's last timestamp when there are no sidecars", async () => {
    const { root } = await writeSession({});
    const s = (await listSessions({ root })).find((x) => x.id === SID)!;
    expect(s.lastActivityMs).toBe(STALE_MS);
  });

  it("a fresh subagent transcript makes a stale main session report recent activity", async () => {
    const { root, freshMs } = await writeSession({ subagent: true });
    const s = (await listSessions({ root })).find((x) => x.id === SID)!;
    expect(s.lastActivityMs).toBeDefined();
    expect(s.lastActivityMs!).toBeGreaterThan(STALE_MS);
    // ~ the subagent file mtime (FS timestamp resolution gives a little slack).
    expect(Math.abs(s.lastActivityMs! - freshMs)).toBeLessThan(2000);
  });

  it("a fresh workflow journal also surfaces as recent activity", async () => {
    const { root, freshMs } = await writeSession({ workflow: true });
    const s = (await listSessions({ root })).find((x) => x.id === SID)!;
    expect(s.lastActivityMs!).toBeGreaterThan(STALE_MS);
    expect(Math.abs(s.lastActivityMs! - freshMs)).toBeLessThan(2000);
  });

  it("getSession (detail path) carries lastActivityMs too", async () => {
    const { root, freshMs } = await writeSession({ subagent: true });
    const detail = (await getSession(SID, { root }))!;
    expect(detail.lastActivityMs!).toBeGreaterThan(STALE_MS);
    expect(Math.abs(detail.lastActivityMs! - freshMs)).toBeLessThan(2000);
  });

  it("nested activity is recomputed fresh, not frozen by the mtime-keyed meta cache", async () => {
    // List once with no sidecar (caches parent-only meta), then drop in a fresh
    // subagent WITHOUT touching the main file, and list again. The main JSONL's
    // mtime is unchanged so the meta cache hits — but lastActivityMs must still
    // pick up the new nested write (the whole point of computing it outside the
    // cache).
    const { root } = await writeSession({});
    const first = (await listSessions({ root })).find((x) => x.id === SID)!;
    expect(first.lastActivityMs).toBe(STALE_MS);

    const subDir = path.join(root, PROJECT_DIR, SID, "subagents");
    await fs.mkdir(subDir, { recursive: true });
    const p = path.join(subDir, "agent-late.jsonl");
    await fs.writeFile(p, jsonl([{ type: "assistant", uuid: "s2", timestamp: STALE_TS, sessionId: SID, message: { id: "m2", role: "assistant", content: [{ type: "text", text: "late" }] } }]));
    const freshMs = Date.now();
    await fs.utimes(p, new Date(freshMs), new Date(freshMs));

    const second = (await listSessions({ root })).find((x) => x.id === SID)!;
    expect(second.lastActivityMs!).toBeGreaterThan(STALE_MS);
    expect(Math.abs(second.lastActivityMs! - freshMs)).toBeLessThan(2000);
  });
});
