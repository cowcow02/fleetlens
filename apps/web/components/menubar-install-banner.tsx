"use client";

import { useEffect, useState } from "react";

type MenubarState = {
  supported: boolean;
  installed: boolean;
  running: boolean;
  bundled: boolean;
};

const DISMISS_KEY = "fleetlens:menubar-banner-dismissed";

// Global, dismissible "install the menu bar widget" banner. Fetches state on
// mount and self-hides once installed (or when the user dismisses it). Mirrors
// components/team-welcome-banner.tsx styling + localStorage-dismiss pattern.
export function MenubarInstallBanner() {
  const [hidden, setHidden] = useState(true); // start hidden to avoid SSR flash
  const [state, setState] = useState<MenubarState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/menubar", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: MenubarState) => {
        if (cancelled) return;
        setState(s);
        const dismissed = window.localStorage.getItem(DISMISS_KEY);
        // Show only on macOS, when not installed, and not previously dismissed.
        // bundled=false (a build shipped without the .app, or `pnpm dev`) →
        // install can only 500; don't invite the click.
        if (s.supported && s.bundled && !s.installed && !dismissed) setHidden(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-hide if a background refresh (SSE router.refresh) flips installed=true.
  useEffect(() => {
    if (state?.installed) setHidden(true);
  }, [state?.installed]);

  if (hidden) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setHidden(true);
  };

  async function install() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/menubar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "install" }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.error ?? `Error ${res.status}`);
      return;
    }
    setState(body);
  }

  return (
    <div
      role="status"
      style={{
        padding: "10px 24px",
        background: "var(--af-accent-subtle)",
        borderBottom: "1px solid var(--af-accent)",
        color: "var(--af-text)",
        fontSize: 13,
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <span style={{ flex: 1 }}>
        Get live Claude Code / Codex / Z.ai usage in your menu bar —{" "}
        <strong>install the Fleetlens widget</strong>.
      </span>
      <button
        type="button"
        className="af-btn af-btn-primary"
        disabled={busy}
        onClick={() => void install()}
        style={{ fontSize: 12, padding: "4px 12px" }}
      >
        {busy ? "Installing…" : "Install"}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--af-text-tertiary)",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: "2px 6px",
        }}
      >
        ×
      </button>
      {error && (
        <span style={{ color: "var(--af-danger, #dc2626)" }}>{error}</span>
      )}
    </div>
  );
}
