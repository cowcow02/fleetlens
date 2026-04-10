"use client";

/**
 * Global live-update bridge. Subscribes to /api/events once for the
 * whole app and calls router.refresh() (debounced) whenever any
 * session's JSONL file changes. That re-runs the current RSC loader,
 * which re-reads the parser cache (now freshly invalidated by the
 * SSE watcher on the server) and streams the new UI down.
 *
 * Session detail pages can optionally subscribe themselves for more
 * granular updates, but the default router.refresh() is good enough
 * because the parser cache makes re-parsing cheap after the first
 * read.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useLiveEvents, type LiveSessionUpdate } from "@/lib/use-live-events";

/** Debounce router.refresh() so a burst of writes doesn't hammer
 *  the RSC loader. 400ms covers the end of a tool result flush. */
const REFRESH_DEBOUNCE_MS = 400;

export function LiveRefresher() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMtimeRef = useRef<number>(0);

  const onUpdate = useCallback(
    (update: LiveSessionUpdate) => {
      // Only count the *latest* update; drop older/equal mtimes.
      if (update.mtimeMs <= lastMtimeRef.current) return;
      lastMtimeRef.current = update.mtimeMs;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    },
    [router],
  );

  useLiveEvents(onUpdate);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return null;
}
