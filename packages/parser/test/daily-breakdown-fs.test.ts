import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSessions, clearClaudeCodeCaches } from "../src/claude-code.js";

beforeEach(() => clearClaudeCodeCaches());

const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PROJECT_DIR = "-Users-me-Repo-demo";

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n");

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
