"use client";

/**
 * A small "LIVE" badge that pulses when a session was updated very
 * recently. The "live" window is 45s by default — after that we drop
 * the badge and assume the session went idle.
 *
 * The freshness re-evaluates every 10s while mounted so a session
 * that went idle fades out without the user having to refresh.
 */

import { useEffect, useState } from "react";

const LIVE_WINDOW_MS = 45_000;

export function LiveBadge({
  mtimeIso,
  size = "sm",
}: {
  mtimeIso?: string;
  size?: "sm" | "md";
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  if (!mtimeIso) return null;
  const ms = Date.parse(mtimeIso);
  if (Number.isNaN(ms) || now - ms > LIVE_WINDOW_MS) return null;

  const dotSize = size === "md" ? 8 : 6;
  const padV = size === "md" ? "3px 9px" : "2px 7px";
  const fontSize = size === "md" ? 10 : 9;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: padV,
        borderRadius: 100,
        background: "rgba(239, 68, 68, 0.12)",
        color: "#ef4444",
        textTransform: "uppercase",
      }}
      title={`Last updated ${new Date(ms).toLocaleTimeString()}`}
    >
      <span
        style={{
          display: "inline-block",
          width: dotSize,
          height: dotSize,
          borderRadius: "50%",
          background: "#ef4444",
          animation: "cs-live-pulse 1.6s ease-in-out infinite",
        }}
      />
      LIVE
      <style>{`
        @keyframes cs-live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </span>
  );
}
