import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../src/parser.js";
import { groupByTeam } from "../src/team.js";
import type { SessionDetail, SessionMeta } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fix = (name: string) => join(here, "fixtures", name);

function loadFixture(path: string, id: string): SessionDetail {
  const text = readFileSync(path, "utf8").trim();
  const lines = text.split("\n").map((l) => JSON.parse(l));
  const { meta, events } = parseTranscript(lines);
  return {
    ...meta,
    id,
    filePath: path,
    projectName: "test",
    projectDir: "test",
    events,
  } as SessionDetail;
}

describe("groupByTeam", () => {
  it("clusters lead + 2 members into one TeamView", () => {
    const lead = loadFixture(fix("team-lead.jsonl"), "lead-1");
    const a = loadFixture(fix("team-member-a.jsonl"), "mem-a");
    const b = loadFixture(fix("team-member-b.jsonl"), "mem-b");
    const sessions: SessionMeta[] = [lead, a, b];
    const details = new Map<string, SessionDetail>([
      ["lead-1", lead],
      ["mem-a", a],
      ["mem-b", b],
    ]);
    const views = groupByTeam(sessions, details);
    expect(views).toHaveLength(1);
    const v = views[0]!;
    expect(v.teamName).toBe("alpha");
    expect(v.leadSessionId).toBe("lead-1");
    expect(v.memberSessionIds).toEqual(
      expect.arrayContaining(["mem-a", "mem-b"]),
    );
    expect(v.agentNameBySessionId.get("lead-1")).toBeUndefined();
    expect(v.agentNameBySessionId.get("mem-a")).toBe("member-a");
    expect(v.agentNameBySessionId.get("mem-b")).toBe("member-b");
  });

  it("pairs SendMessage events into TeamMessages with resolved ids", () => {
    const lead = loadFixture(fix("team-lead.jsonl"), "lead-1");
    const a = loadFixture(fix("team-member-a.jsonl"), "mem-a");
    const b = loadFixture(fix("team-member-b.jsonl"), "mem-b");
    const details = new Map<string, SessionDetail>([
      ["lead-1", lead],
      ["mem-a", a],
      ["mem-b", b],
    ]);
    const view = groupByTeam([lead, a, b], details)[0]!;
    expect(view.messages.length).toBe(4);
    const byPair = view.messages.map(
      (m) => `${m.fromSessionId}→${m.toSessionId}`,
    );
    expect(byPair).toEqual(
      expect.arrayContaining([
        "lead-1→mem-a",
        "mem-a→lead-1",
        "lead-1→mem-b",
        "mem-b→lead-1",
      ]),
    );
    for (let i = 1; i < view.messages.length; i++) {
      expect(view.messages[i]!.tsMs).toBeGreaterThanOrEqual(
        view.messages[i - 1]!.tsMs,
      );
    }
  });

  it("skips groups with no lead candidate", () => {
    const a = loadFixture(fix("team-member-a.jsonl"), "mem-a");
    const b = loadFixture(fix("team-member-b.jsonl"), "mem-b");
    const sessions = [a, b];
    const details = new Map<string, SessionDetail>([
      ["mem-a", a],
      ["mem-b", b],
    ]);
    const views = groupByTeam(sessions, details);
    expect(views).toHaveLength(0);
  });

  it("records an unmatched SendMessage with empty toSessionId", () => {
    const lead = loadFixture(fix("team-lead.jsonl"), "lead-1");
    const views = groupByTeam(
      [lead],
      new Map<string, SessionDetail>([["lead-1", lead]]),
    );
    expect(views).toHaveLength(1);
    const msgs = views[0]!.messages;
    expect(msgs.every((m) => m.fromSessionId === "lead-1")).toBe(true);
    expect(msgs.every((m) => m.toSessionId === "")).toBe(true);
  });

  it("tags SendMessage-sourced TeamMessages with kind=message", () => {
    const lead = loadFixture(fix("team-lead.jsonl"), "lead-1");
    const a = loadFixture(fix("team-member-a.jsonl"), "mem-a");
    const b = loadFixture(fix("team-member-b.jsonl"), "mem-b");
    const details = new Map<string, SessionDetail>([
      ["lead-1", lead],
      ["mem-a", a],
      ["mem-b", b],
    ]);
    const view = groupByTeam([lead, a, b], details)[0]!;
    expect(view.messages.every((m) => m.kind === "message")).toBe(true);
  });
});
