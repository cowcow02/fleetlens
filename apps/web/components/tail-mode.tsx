"use client";

/**
 * "Tail mode" floating action button for live sessions.
 *
 * - Shows a "↓ Jump to latest" FAB when the user is NOT at the bottom
 * - Clicking it scrolls to the bottom and enables tail mode
 * - In tail mode: auto-scrolls to the bottom after every render
 *   (new events arrive via LiveRefresher → router.refresh() → RSC re-render)
 * - If the user manually scrolls up, tail mode disables
 * - Shows "Following live" indicator when tailing
 */

import { useEffect, useRef, useState, useCallback, type MutableRefObject } from "react";
import { ArrowDown, Radio } from "lucide-react";

export function TailMode({
  isLive,
  navLockRef,
}: {
  isLive: boolean;
  /** SessionView stamps Date.now() here on every explicit day-jump. While the
   *  stamp is fresh the live-follow observer bails, so a streaming event can't
   *  yank the view back to the bottom mid-navigation. Read synchronously — a
   *  setState couldn't disconnect the observer before its callback fires. */
  navLockRef?: MutableRefObject<number>;
}) {
  const [tailing, setTailing] = useState(isLive);
  const [atBottom, setAtBottom] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const userScrolledRef = useRef(false);

  // Find the <main> scroll container once and auto-scroll if live.
  useEffect(() => {
    mainRef.current = document.querySelector("main");
    if (isLive && mainRef.current) {
      // Small delay so the initial render settles before scrolling. Use an
      // INSTANT scroll, not smooth: a smooth animation emits a stream of scroll
      // events, and check() reads the second one (still mid-animation, not yet
      // at the bottom) as a user scroll-up and kills tailing — so on a heavy
      // session the view never reaches the live tail. Instant lands in one
      // event, which check() correctly sees as "at bottom".
      const t = setTimeout(() => {
        // An explicit day-jump (gotoDay, e.g. opening a live session via
        // ?day=<earlier day>) stamps navLockRef and scrolls to that past day —
        // don't yank the view back to the live tail on top of it.
        if (navLockRef && Date.now() - navLockRef.current < 1500) return;
        userScrolledRef.current = false;
        mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight, behavior: "auto" });
      }, 300);
      return () => clearTimeout(t);
    }
    // navLockRef is a stable ref; listed to satisfy exhaustive-deps without
    // causing re-runs (mirrors the observer effect below).
  }, [isLive, navLockRef]);

  // Track whether we're at the bottom.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const check = () => {
      const threshold = 80; // px from bottom to count as "at bottom"
      const isAtBottom =
        main.scrollHeight - main.scrollTop - main.clientHeight < threshold;
      setAtBottom(isAtBottom);

      // If user scrolled up while tailing, disable tail mode.
      if (tailing && !isAtBottom && userScrolledRef.current) {
        setTailing(false);
      }
      userScrolledRef.current = true;
    };

    check();
    main.addEventListener("scroll", check, { passive: true });
    return () => main.removeEventListener("scroll", check);
  }, [tailing]);

  // Auto-scroll when tailing: after every render, jump to bottom.
  // The LiveRefresher triggers router.refresh() which re-renders the page
  // with new events — this effect catches those re-renders.
  useEffect(() => {
    if (!tailing) return;
    const main = mainRef.current;
    if (!main) return;

    // Use a MutationObserver to detect when new content is added
    // (the RSC re-render appends new transcript rows to the DOM).
    const observer = new MutationObserver(() => {
      // Bail while a day-jump is in flight: SessionView just scrolled the view
      // to an earlier day, and a streaming live event must NOT yank it back to
      // the bottom (that fight was the day-nav "flicker" on live sessions). A
      // moment later check() sees the scroll is away from the bottom and turns
      // tailing off for good. NOTE: do not gate on distance-from-bottom instead
      // — on a heavy session the content streams in while we're still far from
      // the bottom, and a distance gate would abandon the initial catch-up.
      if (navLockRef && Date.now() - navLockRef.current < 1500) return;
      userScrolledRef.current = false; // suppress the scroll-up detection
      // Instant, not smooth: a smooth animation emits scroll events across many
      // frames and check() reads a mid-animation one (still away from the bottom)
      // as a user scroll-up, killing tailing after the first sizeable streamed
      // append. Same reason as the immediate scroll below and the mount scroll.
      main.scrollTo({ top: main.scrollHeight, behavior: "auto" });
    });

    observer.observe(main, { childList: true, subtree: true });

    // Also scroll immediately when tail mode is first enabled. Instant (not
    // smooth) for the same reason as the mount scroll above — a smooth
    // animation's scroll events trip check() into disabling tailing mid-flight.
    userScrolledRef.current = false;
    main.scrollTo({ top: main.scrollHeight, behavior: "auto" });

    return () => observer.disconnect();
    // navLockRef is a stable ref; listed to satisfy exhaustive-deps without
    // causing re-runs.
  }, [tailing, navLockRef]);

  const jumpToLatest = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    userScrolledRef.current = false;
    main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
    setTailing(true);
  }, []);

  const stopTailing = useCallback(() => {
    setTailing(false);
  }, []);

  // Don't show anything if the session isn't live.
  if (!isLive) return null;

  return (
    <>
      {/* Tailing indicator bar */}
      {tailing && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 18px",
            background: "var(--af-surface-elevated)",
            border: "1px solid var(--af-accent)",
            borderRadius: 100,
            fontSize: 12,
            fontWeight: 500,
            color: "var(--af-accent)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            cursor: "pointer",
          }}
          onClick={stopTailing}
          title="Click to stop following"
        >
          <Radio
            size={13}
            style={{ animation: "cs-live-pulse 1.6s ease-in-out infinite" }}
          />
          Following live
          <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", marginLeft: 4 }}>
            click to stop
          </span>
          <style>{`
            @keyframes cs-live-pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
          `}</style>
        </div>
      )}

      {/* Jump to latest FAB — shown when NOT at bottom and NOT already tailing */}
      {!tailing && !atBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          style={{
            position: "fixed",
            bottom: 24,
            right: 32,
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 18px",
            background: "var(--af-accent)",
            color: "#fff",
            border: "none",
            borderRadius: 100,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 4px 16px rgba(45, 212, 191, 0.3)",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 6px 24px rgba(45, 212, 191, 0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 16px rgba(45, 212, 191, 0.3)";
          }}
        >
          <ArrowDown size={14} />
          Jump to latest
        </button>
      )}
    </>
  );
}
