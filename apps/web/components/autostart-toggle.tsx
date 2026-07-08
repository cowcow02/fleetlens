"use client";
import { useState } from "react";
import type { AutostartState } from "@/lib/autostart-data";

export function AutostartToggle({ initial }: { initial: AutostartState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!state.supported) {
    return (
      <p className="text-sm text-gray-500">
        Auto-start uses a macOS LaunchAgent and is macOS-only for now. Add{" "}
        <code className="font-mono text-xs">fleetlens daemon start</code> to your login items manually.
      </p>
    );
  }

  async function toggle(enabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/team/autostart", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
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
    <div className="space-y-2">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.installed}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          Start Fleetlens at login (dashboard + usage daemon)
          <span className="mt-0.5 block text-xs text-gray-500">
            {state.installed
              ? "Enabled — the dashboard and reporting come back after a reboot."
              : state.optedOut
                ? "Disabled — you opted out; joining a team won't re-enable it."
                : "Disabled — pairing with a team enables this automatically."}
          </span>
        </span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
