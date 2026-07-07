"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOG_BG, LOG_GUTTER, levelColor } from "./log-colors";

type LogLevel = "log" | "warn" | "error";
type LogLine = { seq: number; ts: number; level: LogLevel; msg: string };
type LevelFilter = "all" | "warn" | "error";

const POLL_MS = 2500;
const MAX_RENDERED = 5000;

// Terminal-style live tail of the server's raw application log. Polls the
// staff-only /api/admin/logs endpoint; appends new lines by seq. `initialQuery`
// pre-seeds the search box (used to deep-link a single member: member=<id>).
export function LogViewer({ initialQuery = "" }: { initialQuery?: string }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [q, setQ] = useState(initialQuery);
  const [paused, setPaused] = useState(false);
  // Auto-pause while the tab is hidden — kept separate from the manual `paused`
  // button so un-hiding resumes polling unless the user paused it themselves.
  const [hidden, setHidden] = useState(false);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const lastSeqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  // Reset + full refetch whenever the server-side filter (level/q) changes.
  const fetchLines = useCallback(
    async (reset: boolean) => {
      const after = reset ? 0 : lastSeqRef.current;
      const params = new URLSearchParams({ after: String(after), level });
      if (q.trim()) params.set("q", q.trim());
      try {
        const res = await fetch(`/api/admin/logs?${params}`, { cache: "no-store" });
        if (!res.ok) {
          setError(res.status === 403 ? "Staff only." : `Log fetch failed (${res.status}).`);
          return;
        }
        setError(null);
        const data = (await res.json()) as { lines: LogLine[]; lastSeq: number };
        lastSeqRef.current = data.lastSeq;
        setLoaded(true);
        setLines((prev) => {
          const next = reset ? data.lines : [...prev, ...data.lines];
          return next.length > MAX_RENDERED ? next.slice(next.length - MAX_RENDERED) : next;
        });
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [level, q],
  );

  useEffect(() => {
    setLines([]);
    lastSeqRef.current = 0;
    setLoaded(false);
    fetchLines(true);
  }, [fetchLines]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (paused || hidden) return;
    const id = setInterval(() => fetchLines(false), POLL_MS);
    return () => clearInterval(id);
  }, [paused, hidden, fetchLines]);

  // Auto-scroll to bottom on new lines while following.
  useEffect(() => {
    if (followRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== followRef.current) setFollow(atBottom);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter — e.g. [ingest], member=…, error"
          spellCheck={false}
          style={{
            flex: "1 1 260px",
            minWidth: 200,
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 12.5,
            padding: "8px 10px",
            border: "1px solid var(--rule)",
            background: "var(--paper)",
            color: "var(--ink)",
            borderRadius: 2,
          }}
        />
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--rule)", borderRadius: 2 }}>
          {(["all", "warn", "error"] as LevelFilter[]).map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevel(lv)}
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                padding: "7px 12px",
                border: "none",
                cursor: "pointer",
                background: level === lv ? "var(--ink)" : "transparent",
                color: level === lv ? "var(--paper)" : "var(--mute)",
              }}
            >
              {lv}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPaused((v) => !v)}
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "7px 14px",
            border: "1px solid var(--rule)",
            borderRadius: 2,
            cursor: "pointer",
            background: paused ? "var(--warning)" : "var(--paper)",
            color: paused ? "#1a1a1a" : "var(--mute)",
          }}
        >
          {paused ? "paused" : "live"}
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mute)" }}>
        <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
          {lines.length} line{lines.length === 1 ? "" : "s"}
          {paused ? " · paused" : follow ? " · following" : " · scroll to bottom to follow"}
        </span>
        <span>{error && <b style={{ color: "var(--danger)" }}>{error}</b>}</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          height: "min(66vh, 640px)",
          overflow: "auto",
          background: LOG_BG,
          border: "1px solid var(--ink)",
          borderRadius: 2,
          padding: "12px 14px",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        {loaded && lines.length === 0 ? (
          <div style={{ color: "#8a8577", padding: "8px 0" }}>
            {q.trim() || level !== "all"
              ? "No log lines match this filter yet."
              : "No log lines captured yet on this instance. Trigger activity (or wait for a sync) and they'll stream in."}
          </div>
        ) : (
          lines.map((l) => <Line key={l.seq} line={l} q={q.trim()} />)
        )}
      </div>
    </div>
  );
}

function Line({ line, q }: { line: LogLine; q: string }) {
  const time = new Date(line.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
  return (
    <div style={{ display: "flex", gap: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      <span style={{ color: LOG_GUTTER, flex: "0 0 auto", userSelect: "none" }}>{time}</span>
      <span style={{ color: levelColor(line.level), flex: "1 1 auto" }}>{highlight(line.msg, q)}</span>
    </div>
  );
}

// Highlight the active search term so matches are easy to spot in a busy tail.
function highlight(msg: string, q: string) {
  if (!q) return msg;
  const lower = msg.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < msg.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      parts.push(msg.slice(i));
      break;
    }
    if (idx > i) parts.push(msg.slice(i, idx));
    parts.push(
      <mark key={n++} style={{ background: "#c0562f", color: "#fff", padding: "0 1px" }}>
        {msg.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return parts;
}
