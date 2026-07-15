"use client";

import { useState } from "react";
import type { MenubarState } from "@/lib/menubar-data";

type Action = "install" | "open" | "uninstall";

export function MenubarInstall({ initial }: { initial: MenubarState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!state.supported) {
    return (
      <p className="text-sm text-gray-500">
        The menu bar widget is a native macOS app and isn&apos;t available on this platform.
      </p>
    );
  }

  async function run(action: Action, successMsg: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await fetch("/api/menubar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.error ?? `Error ${res.status}`);
      return;
    }
    setState({
      supported: body.supported,
      installed: body.installed,
      running: body.running,
      bundled: body.bundled,
    });
    setDone(successMsg);
  }

  return (
    <div className="space-y-3">
      {!state.bundled && (
        <p className="text-sm text-amber-600">
          This build doesn&apos;t include the widget bundle. Run{" "}
          <code className="font-mono text-xs">fleetlens menubar status</code> for details.
        </p>
      )}

      <p className="text-sm text-gray-500">
        {state.installed
          ? state.running
            ? "Installed and running — check your menu bar."
            : "Installed but not running."
          : "Adds live Claude Code, Codex, Copilot, Z.ai, and Grok quota gauges to your menu bar, updated as the daemon polls."}
      </p>

      <div className="flex flex-wrap gap-2">
        {!state.installed && (
          <button
            type="button"
            className="af-btn af-btn-primary"
            disabled={busy || !state.bundled}
            onClick={() => void run("install", "Installed — check your menu bar.")}
          >
            {busy ? "Installing…" : "Install widget"}
          </button>
        )}
        {state.installed && !state.running && (
          <button
            type="button"
            className="af-btn af-btn-primary"
            disabled={busy}
            onClick={() => void run("open", "Opened — check your menu bar.")}
          >
            {busy ? "Opening…" : "Open widget"}
          </button>
        )}
        {state.installed && (
          <button
            type="button"
            className="af-btn"
            disabled={busy}
            onClick={() => void run("uninstall", "Widget removed.")}
          >
            {busy ? "Removing…" : "Uninstall"}
          </button>
        )}
      </div>

      {state.installed && (
        <p className="text-xs text-gray-500">
          To also launch it at login, run{" "}
          <code className="font-mono text-xs">fleetlens menubar install</code> in your terminal.
        </p>
      )}

      {done && <p className="text-sm text-green-600">{done}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
