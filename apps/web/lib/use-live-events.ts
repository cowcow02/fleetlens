"use client";

/**
 * Live event subscription hook. Opens an EventSource to /api/events
 * and forwards each session-updated event to the caller's handler.
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

type LiveEvent = LiveSessionUpdate | { type: "heartbeat"; tsMs: number } | { type: "ready" };

export function useLiveEvents(onUpdate: (update: LiveSessionUpdate) => void): void {
  // Keep the latest handler in a ref so the EventSource effect doesn't
  // re-open every time the parent re-renders with a new closure.
  const handlerRef = useRef(onUpdate);
  useEffect(() => {
    handlerRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const data: LiveEvent = JSON.parse(e.data);
        if (data.type === "session-updated") {
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
  }, []);
}
