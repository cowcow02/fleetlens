"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncResponse = {
  ok: boolean;
  lines: string[];
  exitCode: number | null;
  error?: string;
};

export function ForceSyncButton({ cliAvailable }: { cliAvailable: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "done">("idle");
  const [result, setResult] = useState<SyncResponse | null>(null);

  const onClick = async () => {
    setState("syncing");
    setResult(null);
    try {
      const res = await fetch("/api/team/sync", { method: "POST" });
      const data: SyncResponse = await res.json();
      setResult(data);
      setState("done");
      if (data.ok) {
        router.refresh();
      }
    } catch (err) {
      setResult({
        ok: false,
        lines: [],
        exitCode: null,
        error: `Request failed: ${(err as Error).message}`,
      });
      setState("done");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={!cliAvailable || state === "syncing"}
          title={
            !cliAvailable
              ? "Force sync is only available when running via the fleetlens CLI"
              : undefined
          }
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === "syncing" ? "Syncing…" : "Sync now"}
        </button>
        <span className="text-xs text-gray-500">
          Push immediately instead of waiting for the next 5-minute daemon cycle.
        </span>
      </div>

      {result && (
        <pre
          className={`rounded border p-3 text-xs font-mono whitespace-pre-wrap ${
            result.ok ? "border-gray-200 bg-gray-50" : "border-red-300 bg-red-50 text-red-700"
          }`}
        >
          {result.lines.length > 0 ? result.lines.join("\n") : ""}
          {result.error ? (result.lines.length > 0 ? "\n" : "") + result.error : ""}
        </pre>
      )}
    </div>
  );
}
