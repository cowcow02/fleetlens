"use client";
import { useState, useCallback } from "react";
import { MonthDigest as MonthDigestRender } from "./month-digest";
import { DigestActions } from "./digest-actions";
import type { MonthDigest as MonthDigestType } from "@claude-lens/entries";

type Status = "idle" | "streaming" | "done" | "error";

export function MonthDigestView({
  initial, yearMonth, aiEnabled,
}: {
  initial: MonthDigestType | null;
  yearMonth: string;
  aiEnabled: boolean;
}) {
  const [digest, setDigest] = useState<MonthDigestType | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<string>("");

  const generate = useCallback(async (force = false) => {
    setStatus("streaming");
    setProgress("Starting...");
    const url = `/api/digest/month/${yearMonth}${force ? "?force=1" : ""}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok || !res.body) {
      setStatus("error");
      setProgress(`Error ${res.status}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) continue;
        try {
          const ev = JSON.parse(dataLine.slice(6));
          if (ev.type === "status") setProgress(ev.text);
          else if (ev.type === "dependency") {
            setProgress(`${ev.kind === "day" ? "Day" : "Week"} ${ev.key} ${ev.status}`);
          }
          else if (ev.type === "entry") setProgress(`Enriching ${ev.index}/${ev.total}...`);
          else if (ev.type === "progress") {
            const sec = Math.round(ev.elapsed_ms / 1000);
            setProgress(`Claude composing… ${ev.bytes.toLocaleString()} chars (${sec}s)`);
          }
          else if (ev.type === "digest") {
            if (ev.digest && ev.digest.scope === "month") {
              setDigest(ev.digest as MonthDigestType);
            }
            setProgress("Rendering...");
          }
          else if (ev.type === "saved") setProgress("Saved.");
          else if (ev.type === "error") { setStatus("error"); setProgress(ev.message); return; }
        } catch { /* skip */ }
      }
    }
    setStatus("done");
    setProgress("");
  }, [yearMonth]);

  const isStreaming = status === "streaming";
  const narrativeFresh = !!digest?.headline;

  const actions = (
    <DigestActions
      digestKey={yearMonth}
      period="month"
      hasDigest={!!digest}
      narrativeFresh={narrativeFresh}
      isStreaming={isStreaming}
      aiEnabled={aiEnabled}
      progress={progress}
      onGenerate={() => generate(false)}
      onReroll={() => generate(true)}
    />
  );

  if (digest) {
    return <MonthDigestRender digest={digest} aiEnabled={aiEnabled} actions={actions} />;
  }
  // Hide the action bar when DigestActions would render nothing (no AI, no progress,
  // no digest → no PDF). Otherwise the empty wrapper leaves visible padding.
  const hasActionContent = aiEnabled || !!progress;
  return (
    <>
      {hasActionContent && (
        <div style={{ display: "flex", gap: 10, padding: "14px 40px 0", alignItems: "center", flexWrap: "wrap" }}>
          {actions}
        </div>
      )}
      <div style={{ padding: 28, textAlign: "center", color: "var(--af-text-secondary)", fontSize: 13 }}>
        {isStreaming ? "Loading month digest…" : "No digest yet — click Generate above."}
      </div>
    </>
  );
}
