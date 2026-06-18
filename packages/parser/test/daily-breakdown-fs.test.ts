import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSessions, getSession, clearClaudeCodeCaches } from "../src/claude-code.js";

beforeEach(() => clearClaudeCodeCaches());

const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PROJECT_DIR = "-Users-me-Repo-demo";

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n");

async function writeSubagentProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "poison-fixture-"));
  const projDir = path.join(root, PROJECT_DIR);
  await fs.mkdir(projDir, { recursive: true });
  await fs.writeFile(
    path.join(projDir, `${SID}.jsonl`),
    jsonl([
      { type: "user", uuid: "u0", parentUuid: null, sessionId: SID, timestamp: "2026-06-02T03:00:00.000Z", cwd: "/Users/me/Repo/demo", message: { role: "user", content: "go" } },
      {
        type: "assistant", uuid: "a1", sessionId: SID, requestId: "rp", timestamp: "2026-06-02T03:00:01.000Z",
        message: { id: "mp", role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "ok" }] },
      },
    ]),
  );
  const subDir = path.join(projDir, SID, "subagents");
  await fs.mkdir(subDir, { recursive: true });
  await fs.writeFile(
    path.join(subDir, "agent-x.jsonl"),
    jsonl([
      {
        type: "assistant", uuid: "s1", timestamp: "2026-06-02T03:00:02.000Z", sessionId: SID, requestId: "rs",
        message: { id: "ms", role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 500, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "sub" }] },
      },
    ]),
  );
  return root;
}

describe("meta cache is not poisoned by the detail path (subagent tokens)", () => {
  // Regression: getCachedDetail backfills the shared metaCache. If it skipped
  // the subagent recompute, opening a session detail page would overwrite the
  // correct list-path total with parent-only tokens and the dashboard would
  // undercount that session for the server's lifetime.
  it("list -> detail -> list all report subagent-inclusive totals regardless of order", async () => {
    const root = await writeSubagentProject();

    const list1 = (await listSessions({ root })).find((x) => x.id === SID)!;
    expect(list1.totalUsage.input).toBe(1500); // parent 1000 + subagent 500

    const detail = (await getSession(SID, { root }))!;
    expect(detail.totalUsage.input).toBe(1500); // detail must be subagent-inclusive too

    const list2 = (await listSessions({ root })).find((x) => x.id === SID)!;
    expect(list2.totalUsage.input).toBe(1500); // cache not poisoned by the detail read

    for (const m of [list1, detail, list2]) {
      const sum = (m.dailyBreakdown ?? []).reduce((a, d) => a + d.tokens.input, 0);
      expect(sum).toBe(m.totalUsage.input);
    }
  });

  it("detail-first ordering also yields subagent-inclusive list totals", async () => {
    const root = await writeSubagentProject();
    const detail = (await getSession(SID, { root }))!;
    expect(detail.totalUsage.input).toBe(1500);
    const list = (await listSessions({ root })).find((x) => x.id === SID)!;
    expect(list.totalUsage.input).toBe(1500);
  });
});

describe("dailyBreakdown token reconciliation (getCachedMeta)", () => {
  it("sum(dailyBreakdown.tokens) === totalUsage even when parent lines lack timestamps but a subagent is dated", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-fixture-"));
    const projDir = path.join(root, PROJECT_DIR);
    await fs.mkdir(projDir, { recursive: true });

    // Parent assistant usage with NO timestamp → firstTimestamp/fallbackDay
    // undefined → the 6000 tokens can't be dated from the parent alone.
    await fs.writeFile(
      path.join(projDir, `${SID}.jsonl`),
      jsonl([
        { type: "user", uuid: "u0", parentUuid: null, sessionId: SID, cwd: "/Users/me/Repo/demo", message: { role: "user", content: "go" } },
        {
          type: "assistant", uuid: "a1", sessionId: SID, requestId: "rp",
          message: { id: "mp", role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 6000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "ok" }] },
        },
      ]),
    );

    // Subagent transcript WITH a timestamp — the only datable usage (280 tok).
    const subDir = path.join(projDir, SID, "subagents");
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(
      path.join(subDir, "agent-x.jsonl"),
      jsonl([
        {
          type: "assistant", uuid: "s1", timestamp: "2026-06-02T03:00:00.000Z", sessionId: SID, requestId: "rs",
          message: { id: "ms", role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 280, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "sub" }] },
        },
      ]),
    );

    const sessions = await listSessions({ root });
    const s = sessions.find((x) => x.id === SID)!;
    const total = s.totalUsage.input + s.totalUsage.output + s.totalUsage.cacheRead + s.totalUsage.cacheWrite;
    const sum = (s.dailyBreakdown ?? []).reduce(
      (a, d) => a + d.tokens.input + d.tokens.output + d.tokens.cacheRead + d.tokens.cacheWrite,
      0,
    );
    expect(total).toBe(6280); // parent 6000 (subagent-inclusive recompute) + subagent 280
    expect(sum).toBe(total); // reconciliation folds the undated 6000 onto the earliest day
  });
});
