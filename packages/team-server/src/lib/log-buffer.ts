// In-memory ring buffer that mirrors the process's own console output so the
// actual application log is readable from the UI without container/stdout
// access. This is the raw line-by-line log (every console.log/warn/error the
// server emits — [ingest] pushes, [scheduler], [migrate], errors), NOT the
// structured per-push audit in member_sync_log.
//
// Caveats worth knowing: it's per-instance and RAM-only, so it resets on
// restart and doesn't span replicas; and it captures the app's own console
// calls, not Next's internal request line (which prod `next start` doesn't
// emit anyway). The buffer + install flag live on globalThis so a dev HMR
// module reload neither double-patches console nor drops accumulated lines.

export type LogLevel = "log" | "warn" | "error";
export type LogLine = { seq: number; ts: number; level: LogLevel; msg: string };

const MAX_LINES = 5000;

type Store = { lines: LogLine[]; seq: number };
const g = globalThis as typeof globalThis & {
  __fleetlensLogStore?: Store;
  __fleetlensLogCaptureInstalled?: boolean;
};
const store: Store = (g.__fleetlensLogStore ??= { lines: [], seq: 0 });

function fmtArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
  if (a === undefined) return "undefined";
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function record(level: LogLevel, args: unknown[]): void {
  const msg = args.map(fmtArg).join(" ");
  store.lines.push({ seq: ++store.seq, ts: Date.now(), level, msg });
  if (store.lines.length > MAX_LINES) {
    store.lines.splice(0, store.lines.length - MAX_LINES);
  }
}

export function installLogCapture(): void {
  if (g.__fleetlensLogCaptureInstalled) return;
  g.__fleetlensLogCaptureInstalled = true;
  (["log", "warn", "error"] as const).forEach((level) => {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      // Never let capture break the caller's logging.
      try {
        record(level, args);
      } catch {
        /* ignore */
      }
    };
  });
}

export type ReadOpts = {
  after?: number; // return lines with seq strictly greater than this
  limit?: number;
  level?: "all" | "warn" | "error"; // "warn" = warn+error, "error" = error only
  q?: string; // case-insensitive substring
};

export function readLog(opts: ReadOpts = {}): { lines: LogLine[]; lastSeq: number } {
  const { after = 0, limit = 1000, level = "all", q } = opts;
  const lastSeq = store.lines.length ? store.lines[store.lines.length - 1].seq : store.seq;

  let lines = store.lines.filter((l) => l.seq > after);
  if (level === "warn") lines = lines.filter((l) => l.level !== "log");
  else if (level === "error") lines = lines.filter((l) => l.level === "error");
  if (q) {
    const needle = q.toLowerCase();
    lines = lines.filter((l) => l.msg.toLowerCase().includes(needle));
  }
  // Cap to the most-recent `limit` (matters on the initial after=0 read).
  if (lines.length > limit) lines = lines.slice(lines.length - limit);

  return { lines, lastSeq };
}
