"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guards against the IntersectionObserver firing a second fetch while one is
  // already in flight (state updates are async, so a bare `loading` check races).
  const inFlight = useRef(false);

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

  // First page on mount.
  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                tried, what the server accepted, and any failure. Newest first. Persisted across
                restarts.
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
            background: "#14120e",
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
                  No sync log uploaded, and the daemon heartbeat is <b style={{ color: "#e8b866" }}>{live.label}</b>.
                  That points at the transport itself — the daemon may be stopped, unpaired, or unable
                  to reach the server. Nothing is arriving to log.
                </>
              ) : (
                <>
                  No sync log yet. The heartbeat is <b style={{ color: "#6fcf8e" }}>{live.label}</b>, so once{" "}
                  {name}&rsquo;s daemon completes a sync (within ~5 min of activity) its lines appear here.
                </>
              )}
            </div>
          ) : (
            rows.map((r) => <LogLine key={r.id} row={r} />)
          )}

          {error && (
            <div style={{ color: "#f0857a", fontSize: 12, padding: "10px 4px" }}>
              Failed to load: {error}{" "}
              <button
                type="button"
                onClick={() => void loadMore()}
                style={{ background: "transparent", border: "none", color: "#e8b866", cursor: "pointer", padding: 0, fontSize: 12 }}
              >
                retry
              </button>
            </div>
          )}

          {/* Sentinel + status row */}
          <div ref={sentinelRef} style={{ height: 1 }} />
          <div style={{ color: "#6b665a", fontSize: 11, padding: "10px 4px", userSelect: "none" }}>
            {loading ? "Loading…" : done && rows.length > 0 ? "— end of log —" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogLine({ row }: { row: Row }) {
  const parsed = parseSyncLine(row.msg);
  return (
    <div style={{ display: "flex", gap: 10, whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "1px 0" }}>
      <span style={{ color: "#6b665a", flex: "0 0 auto", userSelect: "none" }}>
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
          <span style={{ color: "#cfc9b8" }}>{parsed.rest}</span>
        </span>
      ) : (
        <span style={{ color: rawColor(row.level), flex: "1 1 auto" }}>{row.msg}</span>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  ok: "#6fcf8e",
  idle: "#8ab4d8",
  degraded: "#e8b866",
  failed: "#f0a35a",
  error: "#f0857a",
};

function parseSyncLine(msg: string): { status: string; rest: string; color: string } | null {
  const m = msg.match(/^\[sync\] (ok|idle|degraded|failed|error) · (.*)$/s);
  if (!m) return null;
  return { status: m[1], rest: m[2], color: STATUS_COLOR[m[1]] ?? "#cfc9b8" };
}

function rawColor(level: string): string {
  if (level === "error") return "#f0857a";
  if (level === "warn") return "#e8b866";
  return "#cfc9b8";
}

function fmtTs(ms: number): string {
  // mm-dd hh:mm:ss in UTC — compact and monotonic for scanning.
  return new Date(ms).toISOString().slice(5, 19).replace("T", " ");
}

function liveness(ms: number | null): { label: string; color: string; stale: boolean } {
  if (ms == null) return { label: "never", color: "#e8b866", stale: true };
  const age = Date.now() - ms;
  const stale = age >= 30 * 60_000; // > 30 min without a push == transport suspect
  let label: string;
  if (age < 60_000) label = "just now";
  else if (age < 3_600_000) label = `${Math.round(age / 60_000)}m ago`;
  else if (age < 86_400_000) label = `${Math.round(age / 3_600_000)}h ago`;
  else label = `${Math.round(age / 86_400_000)}d ago`;
  return { label, color: stale ? "#e8b866" : "#6fcf8e", stale };
}
