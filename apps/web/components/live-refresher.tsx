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

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useLiveEvents, type LiveUpdate } from "@/lib/use-live-events";

/** Debounce router.refresh() so a burst of writes doesn't hammer
 *  the RSC loader. 400ms covers the end of a tool result flush. */
const REFRESH_DEBOUNCE_MS = 400;

/** Print pages are headless-Chrome render targets — they must never
 *  open long-lived SSE connections or Chrome waits forever for the
 *  page to "settle" before printing. */
function useIsPrintRoute(): boolean {
  const pathname = usePathname();
  return pathname?.includes("/insights/print/") ?? false;
}

export function LiveRefresher() {
  const router = useRouter();
  const isPrint = useIsPrintRoute();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track latest mtime per source so session updates don't starve
  // usage updates (and vice versa) — different files have different clocks.
  const lastMtimeRef = useRef<Record<string, number>>({ session: 0, usage: 0, team: 0 });

  const onUpdate = useCallback(
    (update: LiveUpdate) => {
      const key =
        update.type === "usage-updated" ? "usage" :
        update.type === "team-push" ? "team" :
        "session";
      if (update.mtimeMs <= (lastMtimeRef.current[key] ?? 0)) return;
      lastMtimeRef.current[key] = update.mtimeMs;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    },
    [router],
  );

  useLiveEvents(onUpdate, { enabled: !isPrint });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return null;
}
