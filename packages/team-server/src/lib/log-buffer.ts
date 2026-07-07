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
  __fleetlensLogHydrated?: boolean;
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

// Persistence seams (used by the scheduler flush + boot hydrate). Kept here so
// the buffer stays the single source of truth for seq; the DB module lives in
// the caller so log-buffer.ts stays dependency-free.

// Lines newer than `afterSeq`, for the batch flush to server_log.
export function drainForFlush(afterSeq: number): LogLine[] {
  return store.lines.filter((l) => l.seq > afterSeq);
}

export function currentMaxSeq(): number {
  return store.seq;
}

export function isHydrated(): boolean {
  return !!g.__fleetlensLogHydrated;
}

// Recovery path for a FAILED boot hydrate: fresh seqs restart at 1 and would
// collide with rows already in server_log — the flush's ON CONFLICT (seq)
// DO NOTHING would then silently drop every new line. Shift all buffered seqs
// past the persisted max and continue from there. Marks the store hydrated so
// this runs at most once (and a late hydrate() can't rewind seq).
export function reconcileSeqPast(maxPersistedSeq: number): void {
  if (g.__fleetlensLogHydrated) return;
  g.__fleetlensLogHydrated = true;
  if (maxPersistedSeq <= 0) return;
  for (const l of store.lines) l.seq += maxPersistedSeq;
  store.seq += maxPersistedSeq;
}

// Seed the buffer from persisted rows on boot so the raw log survives a
// reboot. Prepends history, continues `seq` from the persisted max, and
// re-appends any lines captured before hydration (a few migration logs) so
// ordering + monotonicity hold. Idempotent-safe: only hydrates once.
export function hydrate(rows: { seq: number; ts: number; level: LogLevel; msg: string }[]): void {
  if (g.__fleetlensLogHydrated) return;
  g.__fleetlensLogHydrated = true;
  const preHydrate = store.lines.slice();
  store.lines = rows.map((r) => ({ seq: r.seq, ts: r.ts, level: r.level, msg: r.msg }));
  store.seq = rows.length ? rows[rows.length - 1].seq : 0;
  for (const l of preHydrate) record(l.level, [l.msg]);
}
