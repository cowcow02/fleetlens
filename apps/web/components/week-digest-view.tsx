"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { WeekDigest as WeekDigestRender } from "./week-digest";
import { DigestActions } from "./digest-actions";
import type { WeekDigest as WeekDigestType } from "@claude-lens/entries";

type Status = "idle" | "streaming" | "done" | "error";

export function WeekDigestView({
  initial, monday, aiEnabled, autoFire = false, prior,
}: {
  initial: WeekDigestType | null;
  monday: string;
  aiEnabled: boolean;
  autoFire?: boolean;
  prior?: WeekDigestType | null;
}) {
  const [digest, setDigest] = useState<WeekDigestType | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<string>("");
  const firedRef = useRef(false);

  const generate = useCallback(async (force = false) => {
    setStatus("streaming");
    setProgress("Starting...");
    const url = `/api/digest/week/${monday}${force ? "?force=1" : ""}`;
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
            if (ev.digest && ev.digest.scope === "week") {
              setDigest(ev.digest as WeekDigestType);
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
  }, [monday]);

  useEffect(() => {
    if (autoFire && !firedRef.current && status === "idle") {
      firedRef.current = true;
      void generate(false);
    }
  }, [autoFire, status, generate]);

  const isStreaming = status === "streaming";
  const narrativeFresh = !!digest?.headline;

  const actions = (
    <DigestActions
      digestKey={monday}
      period="week"
      hasDigest={!!digest}
      narrativeFresh={narrativeFresh}
      isStreaming={isStreaming}
      aiEnabled={aiEnabled}
      progress={progress}
      onGenerate={() => generate(false)}
      onReroll={() => generate(true)}
      rerollTitle="Re-roll the narrative for this week"
    />
  );

  if (digest) {
    return <WeekDigestRender digest={digest} aiEnabled={aiEnabled} actions={actions} priorDigest={prior ?? null} />;
  }
  return (
    <EmptyWeekState
      monday={monday}
      isStreaming={isStreaming}
      aiEnabled={aiEnabled}
      progress={progress}
      onGenerate={() => generate(false)}
    />
  );
}

function EmptyWeekState({ monday, isStreaming, aiEnabled, progress, onGenerate }: {
  monday: string;
  isStreaming: boolean;
  aiEnabled: boolean;
  progress: string | null;
  onGenerate: () => void;
}) {
  const start = new Date(`${monday}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const range = `${fmt(start)} — ${fmt(end)}`;
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "60px 40px" }}>
      <div style={{
        margin: "0 auto", maxWidth: 480,
        padding: "32px 28px",
        borderRadius: 14,
        background: "var(--af-surface)",
        border: "1px dashed var(--af-border-subtle)",
        textAlign: "center",
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, margin: "0 auto 16px",
          background: "var(--af-accent-subtle)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--af-accent)", fontSize: 20,
        }}>✦</div>
        <h2 style={{
          fontSize: 16, fontWeight: 600, margin: "0 0 6px",
          color: "var(--af-text)", letterSpacing: "-0.01em",
        }}>
          {isStreaming ? "Generating digest…" : "No digest yet for this week"}
        </h2>
        <p style={{
          fontSize: 12.5, lineHeight: 1.55, margin: "0 0 18px",
          color: "var(--af-text-secondary)",
        }}>
          {isStreaming
            ? `Synthesizing ${range} from this week's day digests. This usually takes 5–10 minutes.`
            : aiEnabled
              ? `Once generated, this view shows top sessions, trajectory, findings, and project areas for ${range}.`
              : `Enable AI features in Settings to synthesize a weekly narrative for ${range}. Deterministic stats are still available below in the live digest as soon as data lands.`}
        </p>
        {aiEnabled && (
          <button
            onClick={onGenerate}
            disabled={isStreaming}
            style={{
              padding: "9px 18px", borderRadius: 8,
              background: isStreaming ? "var(--af-border-subtle)" : "var(--af-accent)",
              color: isStreaming ? "var(--af-text-tertiary)" : "white",
              border: "none", cursor: isStreaming ? "default" : "pointer",
              fontSize: 13, fontWeight: 600, letterSpacing: "-0.005em",
            }}
          >
            {isStreaming ? "Generating…" : "Generate digest"}
          </button>
        )}
        {progress && (
          <div style={{
            marginTop: 12, fontSize: 10.5, color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}>
            {progress}
          </div>
        )}
      </div>
    </div>
  );
}

