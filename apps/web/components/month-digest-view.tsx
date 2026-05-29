"use client";
import { useState, useCallback, type ReactNode } from "react";
import { MonthDigest as MonthDigestRender } from "./month-digest";
import { ExportPdfButton } from "./export-pdf-button";
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
  const pdfAction = digest ? <ExportPdfButton digestKey={`month-${yearMonth}`} /> : null;

  let actions: ReactNode = null;
  if (!narrativeFresh && aiEnabled) {
    actions = (
      <button
        onClick={() => generate(false)}
        disabled={isStreaming}
        style={{
          padding: "4px 10px",
          background: "var(--af-accent)",
          color: "white",
          border: "none",
          borderRadius: 5,
          cursor: isStreaming ? "default" : "pointer",
          fontSize: 11,
          fontWeight: 600,
          opacity: isStreaming ? 0.6 : 1,
        }}
      >
        {isStreaming ? "Generating..." : digest ? "Generate" : "Generate digest"}
      </button>
    );
  } else if (aiEnabled) {
    actions = (
      <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", display: "inline-flex", gap: 6, alignItems: "center" }}>
        ✓ Up to date
        <button
          onClick={() => generate(true)}
          disabled={isStreaming}
          style={{
            padding: "2px 7px",
            background: "transparent",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 4,
            fontSize: 10,
            color: "var(--af-text-secondary)",
            cursor: isStreaming ? "default" : "pointer",
            opacity: isStreaming ? 0.6 : 1,
          }}
        >
          {isStreaming ? "..." : "Re-roll"}
        </button>
      </span>
    );
  }
  if (progress) {
    actions = (
      <>
        {actions}
        <span style={{ fontSize: 10, color: "var(--af-text-tertiary)" }}>{progress}</span>
      </>
    );
  }
  if (pdfAction) {
    actions = (
      <>
        {actions}
        {pdfAction}
      </>
    );
  }

  if (digest) {
    return <MonthDigestRender digest={digest} aiEnabled={aiEnabled} actions={actions} />;
  }
  return (
    <>
      {actions && (
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
