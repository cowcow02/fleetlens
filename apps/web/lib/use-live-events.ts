"use client";

/**
 * Live event subscription hook. Opens an EventSource to /api/events
 * and forwards each update event to the caller's handler.
 *
 * Two event types today:
 *   - session-updated: a JSONL in ~/.claude/projects/ changed
 *   - usage-updated:   ~/.cclens/usage.jsonl was appended to by the daemon
 *
 * The caller receives both through a single handler — they're
 * both signals that "something the UI depends on has changed, so
 * re-fetch".
 *
 * The connection is automatically re-established if the browser
 * drops it. Heartbeats keep it alive through idle periods.
 */

import { useEffect, useRef } from "react";

export type LiveSessionUpdate = {
  type: "session-updated";
  sessionId: string;
  projectDir: string;
  mtimeMs: number;
};

export type LiveUsageUpdate = {
  type: "usage-updated";
  mtimeMs: number;
};

export type LiveTeamPushUpdate = {
  type: "team-push";
  mtimeMs: number;
};

export type LiveUpdate = LiveSessionUpdate | LiveUsageUpdate | LiveTeamPushUpdate;

type LiveEvent = LiveUpdate | { type: "heartbeat"; tsMs: number } | { type: "ready" };

export function useLiveEvents(
  onUpdate: (update: LiveUpdate) => void,
  options: { enabled?: boolean } = {},
): void {
  const { enabled = true } = options;
  // Keep the latest handler in a ref so the EventSource effect doesn't
  // re-open every time the parent re-renders with a new closure.
  const handlerRef = useRef(onUpdate);
  useEffect(() => {
    handlerRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const data: LiveEvent = JSON.parse(e.data);
        if (
          data.type === "session-updated" ||
          data.type === "usage-updated" ||
          data.type === "team-push"
        ) {
          handlerRef.current(data);
        }
      } catch {
        // ignore malformed messages
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects on its own. We don't close it here —
      // closing would prevent the automatic retry.
    };
    return () => {
      es.close();
    };
  }, [enabled]);
}
