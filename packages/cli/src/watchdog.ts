/**
 * Wedge detector for the web server. The pid can be alive and the port
 * listening while the event loop is livelocked (GC death spiral, 2026-07-18)
 * — so liveness is judged by HTTP probes, not process checks. Pure state
 * machine: the daemon feeds probe outcomes in, verdicts come out.
 */

export type WatchdogVerdict = "ok" | "failing" | "restart" | "gave-up";

// 3 consecutive failed probes ≈ 2-3 min wedged at the daemon's cadence —
// long enough that a legitimately heavy page render can't trip it.
const FAILURE_THRESHOLD = 3;
// A browser tab re-opening a heavy session page can re-wedge each fresh
// server; without a cap that's a restart flap loop.
const MAX_RESTARTS_PER_WINDOW = 3;
const WINDOW_MS = 60 * 60 * 1000;

export class ServerWatchdog {
  private failures = 0;
  private restartsAt: number[] = [];

  /** A different pid is serving now. The failure run belongs to the old
   *  process — a fresh server gets full grace — but the restart cap stays:
   *  watchdog restarts change the pid too, and clearing the cap on every
   *  one would disarm the flap guard entirely. */
  noteNewInstance(): void {
    this.failures = 0;
  }

  /** No tracked server at all (pid file gone). Watchdog restarts never pass
   *  through this state — only an operator stop (or a cycle the watchdog
   *  happens to observe mid-gap) does — so a human is at the wheel and the
   *  restart budget re-arms in full. */
  noteServerGone(): void {
    this.failures = 0;
    this.restartsAt = [];
  }

  onProbe(ok: boolean, nowMs: number): WatchdogVerdict {
    if (ok) {
      this.failures = 0;
      return "ok";
    }
    // Clamp at the threshold: behavior only compares against it, and a
    // wedge that outlives the restart cap would otherwise grow this forever.
    this.failures = Math.min(this.failures + 1, FAILURE_THRESHOLD);
    if (this.failures < FAILURE_THRESHOLD) return "failing";
    this.restartsAt = this.restartsAt.filter((t) => nowMs - t < WINDOW_MS);
    if (this.restartsAt.length >= MAX_RESTARTS_PER_WINDOW) return "gave-up";
    this.restartsAt.push(nowMs);
    this.failures = 0;
    return "restart";
  }
}
