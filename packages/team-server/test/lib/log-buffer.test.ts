import { describe, it, expect } from "vitest";
import { installLogCapture, readLog, isHydrated, reconcileSeqPast } from "../../src/lib/log-buffer";

// Unique marker so assertions ignore any other console noise in the buffer.
const M = `__logbuf_test_${Math.round(performance.now())}`;

describe("log-buffer", () => {
  it("captures console.log/warn/error and filters by substring", () => {
    installLogCapture();
    console.log(`${M} info line`, { a: 1 });
    console.warn(`${M} warn line`);
    console.error(`${M} error line`);

    const { lines } = readLog({ q: M, limit: 100 });
    expect(lines).toHaveLength(3);
    expect(lines[0].level).toBe("log");
    expect(lines[0].msg).toContain(`${M} info line`);
    expect(lines[0].msg).toContain('{"a":1}'); // non-string args serialized
    expect(lines.map((l) => l.level)).toEqual(["log", "warn", "error"]);
  });

  it("level=warn returns warn+error, level=error returns error only", () => {
    installLogCapture();
    const w = `${M}_lvl`;
    console.log(`${w} a`);
    console.warn(`${w} b`);
    console.error(`${w} c`);

    expect(readLog({ q: w, level: "warn" }).lines.map((l) => l.level)).toEqual(["warn", "error"]);
    expect(readLog({ q: w, level: "error" }).lines.map((l) => l.level)).toEqual(["error"]);
  });

  it("after=<seq> returns only newer lines and advances lastSeq", () => {
    installLogCapture();
    const a = `${M}_after`;
    console.log(`${a} first`);
    const mid = readLog({ q: a });
    const firstSeq = mid.lines[0].seq;
    console.log(`${a} second`);

    const tail = readLog({ q: a, after: firstSeq });
    expect(tail.lines).toHaveLength(1);
    expect(tail.lines[0].msg).toContain("second");
    expect(tail.lastSeq).toBeGreaterThanOrEqual(tail.lines[0].seq);
  });

  // Failed-boot-hydrate recovery: without re-anchoring, fresh seqs collide
  // with persisted rows and ON CONFLICT (seq) DO NOTHING drops every new line.
  // Runs LAST in this file — it flips the global hydrated flag.
  it("reconcileSeqPast shifts buffered seqs past the persisted max, exactly once", () => {
    installLogCapture();
    const r = `${M}_reconcile`;
    console.log(`${r} line`);
    const before = readLog({ q: r }).lines[0].seq;
    expect(isHydrated()).toBe(false);

    reconcileSeqPast(1000);
    expect(isHydrated()).toBe(true);
    expect(readLog({ q: r }).lines[0].seq).toBe(before + 1000);

    // Second call is a no-op — seqs must not drift again.
    reconcileSeqPast(5000);
    expect(readLog({ q: r }).lines[0].seq).toBe(before + 1000);
  });
});
