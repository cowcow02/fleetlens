"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOG_AMBER,
  LOG_BG,
  LOG_BLUE,
  LOG_FG,
  LOG_GREEN,
  LOG_GUTTER,
  LOG_ORANGE,
  LOG_RED,
  levelColor,
} from "../../../../../components/log-colors";
import { liveness } from "./sync-liveness";

type Row = { id: number; tsMs: number; level: string; msg: string };

// The per-member "View logs" modal: the member's OWN daemon sync log, uploaded
// from their machine on every push — the client-side troubleshooting story
// (what the daemon tried, computed, and each push's result/error). Infinite
// scroll pages back through history via the bigserial `id` cursor. The header
// pairs the log with the daemon's LIVENESS: an empty log next to a stale
// heartbeat means the transport itself is broken (nothing is reaching us) —
// the one case the uploaded log can't explain on its own.
export function MemberSyncLogModal({
  slug,
  membershipId,
  name,
  daemonLastSeenAtMs,
  onClose,
}: {
  slug: string;
  membershipId: string;
  name: string;
  daemonLastSeenAtMs: number | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  // ids that arrived via the live poll — briefly flashed so a sync landing while
  // the modal is open is visible, not silent.
  const [freshIds, setFreshIds] = useState<Set<number>>(() => new Set());

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guards against the IntersectionObserver firing a second older-page fetch
  // while one is already in flight (state updates are async, so a bare `loading`
  // check races). The live poll uses its own guard so the two never block.
  const inFlight = useRef(false);
  const pollInFlight = useRef(false);
  // Newest id currently shown — the cursor for the "fetch newer" poll. Kept in a
  // ref so the interval reads the live value without re-subscribing each render.
  const newestIdRef = useRef<number | null>(null);
  // Pending flash-fade timers, cleared on unmount so a closed modal can't fire
  // setState on an unmounted component.
  const flashTimersRef = useRef<Set<number>>(new Set());

  const loadMore = useCallback(async () => {
    if (inFlight.current || done) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const qs = cursor != null ? `?before=${cursor}` : "";
      const res = await fetch(`/api/team/${slug}/members/${membershipId}/daemon-log${qs}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body: { rows: Row[]; nextCursor: number | null } = await res.json();
      setRows((prev) => [...prev, ...body.rows]);
      setCursor(body.nextCursor);
      if (body.nextCursor == null) setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setLoading(false);
      setLoadedOnce(true);
    }
  }, [cursor, done, slug, membershipId]);

  // Poll for rows newer than the top of the list so a sync that fires while the
  // modal is open shows up on its own. `after` mode never overlaps existing rows;
  // the empty-list case (zero history yet) falls back to the newest page and
  // seeds pagination state.
  const pollNewer = useCallback(async () => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const after = newestIdRef.current;
      const qs = after != null ? `?after=${after}` : "";
      const res = await fetch(`/api/team/${slug}/members/${membershipId}/daemon-log${qs}`);
      if (!res.ok) return;
      const body: { rows: Row[]; nextCursor: number | null } = await res.json();
      // A successful poll supersedes a failed mount fetch — clear the stale
      // "Failed to load … retry" banner instead of leaving it up forever.
      setError(null);
      setLoadedOnce(true);
      if (body.rows.length === 0) return;
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const incoming = body.rows.filter((r) => !seen.has(r.id));
        if (incoming.length === 0) return prev;
        return [...incoming, ...prev];
      });
      const ids = body.rows.map((r) => r.id);
      setFreshIds((prev) => new Set([...prev, ...ids]));
      const timer = window.setTimeout(() => {
        flashTimersRef.current.delete(timer);
        setFreshIds((prev) => {
          const next = new Set(prev);
          ids.forEach((i) => next.delete(i));
          return next;
        });
      }, 2500);
      flashTimersRef.current.add(timer);
      // Only the empty-list fallback (no `after`) carries pagination state.
      if (after == null) {
        setCursor(body.nextCursor);
        if (body.nextCursor == null) setDone(true);
      }
    } catch {
      // Transient poll failure — the next tick retries.
    } finally {
      pollInFlight.current = false;
    }
  }, [slug, membershipId]);

  // Keep the poll cursor pointed at the newest row on screen.
  useEffect(() => {
    newestIdRef.current = rows.length > 0 ? rows[0].id : null;
  }, [rows]);

  // First page on mount.
  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live poll every 10s while the modal is open — skipped in hidden tabs, with
  // an immediate catch-up poll when the tab becomes visible again.
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (!document.hidden) void pollNewer();
    }, 10_000);
    const onVisible = () => {
      if (!document.hidden) void pollNewer();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollNewer]);

  // Clear pending flash-fade timers on unmount.
  useEffect(() => {
    const timers = flashTimersRef.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Infinite scroll: observe a sentinel at the bottom of the scroll body.
  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root, rootMargin: "160px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [loadMore]);

  const live = liveness(daemonLastSeenAtMs);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Sync log for ${name}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--ink) 62%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper)",
          border: "1px solid var(--ink)",
          boxShadow: "14px 14px 0 var(--ink)",
          width: "100%",
          maxWidth: 860,
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "22px 26px 16px", borderBottom: "1px solid var(--rule)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div>
              <h3
                style={{
                  fontFamily: '"Instrument Serif", serif',
                  fontSize: 26,
                  lineHeight: 1.1,
                  margin: "0 0 6px",
                }}
              >
                Sync log · {name}
              </h3>
              <p style={{ color: "var(--mute)", fontSize: 12.5, lineHeight: 1.5, margin: 0, maxWidth: "62ch" }}>
                Uploaded from {name}&rsquo;s machine on every push — one line per sync run: what it
                tried, what the server accepted, and any failure. Newest first, in your local time,
                and live: new syncs appear here on their own. Persisted across restarts.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{
                border: "1px solid var(--rule)",
                background: "var(--paper)",
                color: "var(--mute)",
                cursor: "pointer",
                width: 30,
                height: 30,
                fontSize: 16,
                lineHeight: 1,
                borderRadius: 2,
                flex: "0 0 auto",
              }}
            >
              ✕
            </button>
          </div>

          {/* Liveness — pairs the log with the daemon heartbeat so an empty log
              next to a stale heartbeat reads as "transport broken", not "healthy". */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 14,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: 11.5,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: live.color,
                flex: "0 0 auto",
              }}
            />
            <span style={{ color: live.color, fontWeight: 600 }}>DAEMON · {live.label}</span>
            <span style={{ color: "var(--mute)" }}>· heartbeat from the metrics push</span>
          </div>
        </div>

        {/* Scroll body — dark terminal list, newest first, pages older on scroll. */}
        <div
          ref={scrollRef}
          style={{
            flex: "1 1 auto",
            overflowY: "auto",
            background: LOG_BG,
            padding: "12px 16px",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 12,
            lineHeight: 1.65,
          }}
        >
          {rows.length === 0 && loadedOnce && !error ? (
            <div style={{ color: "#8a8474", fontSize: 12.5, padding: "18px 4px", lineHeight: 1.6 }}>
              {live.stale ? (
                <>
                  No sync log uploaded, and the daemon heartbeat is <b style={{ color: LOG_AMBER }}>{live.label}</b>.
                  That points at the transport itself — the daemon may be stopped, unpaired, or unable
                  to reach the server. Nothing is arriving to log.
                </>
              ) : (
                <>
                  No sync log yet. The heartbeat is <b style={{ color: LOG_GREEN }}>{live.label}</b>, so once{" "}
                  {name}&rsquo;s daemon completes a sync (within ~5 min of activity) its lines appear here.
                </>
              )}
            </div>
          ) : (
            rows.map((r) => <LogLine key={r.id} row={r} fresh={freshIds.has(r.id)} />)
          )}

          {error && (
            <div style={{ color: LOG_RED, fontSize: 12, padding: "10px 4px" }}>
              Failed to load: {error}{" "}
              <button
                type="button"
                onClick={() => void loadMore()}
                style={{ background: "transparent", border: "none", color: LOG_AMBER, cursor: "pointer", padding: 0, fontSize: 12 }}
              >
                retry
              </button>
            </div>
          )}

          {/* Sentinel + status row */}
          <div ref={sentinelRef} style={{ height: 1 }} />
          <div style={{ color: LOG_GUTTER, fontSize: 11, padding: "10px 4px", userSelect: "none" }}>
            {loading ? "Loading…" : done && rows.length > 0 ? "— end of log —" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogLine({ row, fresh }: { row: Row; fresh: boolean }) {
  const parsed = parseSyncLine(row.msg);
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        padding: "1px 0",
        // Flash a line that just arrived via the live poll, then fade out.
        borderLeft: fresh ? `2px solid ${LOG_GREEN}` : "2px solid transparent",
        paddingLeft: 8,
        marginLeft: -10,
        background: fresh ? "rgba(111,207,142,0.12)" : "transparent",
        transition: "background 1.2s ease, border-color 1.2s ease",
      }}
    >
      <span style={{ color: LOG_GUTTER, flex: "0 0 auto", userSelect: "none" }}>
        {fmtTs(row.tsMs)}
      </span>
      {parsed ? (
        <span style={{ flex: "1 1 auto" }}>
          <span
            style={{
              color: parsed.color,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginRight: 8,
            }}
          >
            {parsed.status}
          </span>
          <span style={{ color: LOG_FG }}>{parsed.rest}</span>
        </span>
      ) : (
        <span style={{ color: levelColor(row.level), flex: "1 1 auto" }}>{row.msg}</span>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  ok: LOG_GREEN,
  idle: LOG_BLUE,
  degraded: LOG_AMBER,
  failed: LOG_ORANGE,
  error: LOG_RED,
};

function parseSyncLine(msg: string): { status: string; rest: string; color: string } | null {
  const m = msg.match(/^\[sync\] (ok|idle|degraded|failed|error) · (.*)$/s);
  if (!m) return null;
  return { status: m[1], rest: m[2], color: STATUS_COLOR[m[1]] ?? LOG_FG };
}

function fmtTs(ms: number): string {
  // mm-dd hh:mm:ss in the VIEWER's local time — the admin reads the log in their
  // own zone, not UTC. Client-only component, so no SSR hydration mismatch.
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
