"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Fluency } from "@claude-lens/entries";

type Scorecard = Fluency.SubagentScorecard;
type Phase = "idle" | "loading-cache" | "needs-run" | "running" | "ready" | "error";

type ProgressLog = Array<{ phase: string; text: string; ts: number }>;

export function SubagentLaneClient({ initialScorecard }: { initialScorecard?: Scorecard | null }) {
  const [phase, setPhase] = useState<Phase>(initialScorecard ? "ready" : "loading-cache");
  const [scorecard, setScorecard] = useState<Scorecard | null>(initialScorecard ?? null);
  const [log, setLog] = useState<ProgressLog>([]);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ sessions?: number; turns?: number }>({});
  const startedAt = useRef<number>(0);
  const ranOnce = useRef(false);

  const pushLog = useCallback((phase: string, text: string) => {
    setLog((cur) => [...cur, { phase, text, ts: Date.now() }]);
  }, []);

  const runStream = useCallback(async (force = false) => {
    if (ranOnce.current && phase === "running") return;
    ranOnce.current = true;
    setPhase("running");
    setError(null);
    setLog([{ phase: "start", text: "Starting subagent run…", ts: Date.now() }]);
    startedAt.current = Date.now();
    try {
      const res = await fetch(`/api/fluency/subagent${force ? "?refresh=1" : ""}`, { method: "POST" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Parse SSE — split on double-newline
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = chunk.split("\n");
          const eventName = lines.find((l) => l.startsWith("event: "))?.slice(7).trim();
          const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6).trim();
          if (!dataLine) continue;
          let payload: Fluency.SubagentPipelineEvent | { [k: string]: unknown };
          try { payload = JSON.parse(dataLine); } catch { continue; }
          if (eventName === "done") {
            // server signal — handle below by checking phase
          } else if ((payload as Fluency.SubagentPipelineEvent).type === "status") {
            const ev = payload as Extract<Fluency.SubagentPipelineEvent, { type: "status" }>;
            pushLog(ev.phase, ev.text);
          } else if ((payload as Fluency.SubagentPipelineEvent).type === "scorecard") {
            const ev = payload as Extract<Fluency.SubagentPipelineEvent, { type: "scorecard" }>;
            setScorecard(ev.scorecard);
            setPhase("ready");
          } else if ((payload as Fluency.SubagentPipelineEvent).type === "error") {
            const ev = payload as Extract<Fluency.SubagentPipelineEvent, { type: "error" }>;
            setError(ev.message);
            setPhase("error");
          }
        }
      }
      // Stream closed — if we didn't get a scorecard or error, set error
      if (!scorecard) {
        // refresh from cache one more time
        const r2 = await fetch("/api/fluency/subagent");
        if (r2.ok) {
          const j = (await r2.json()) as { scorecard?: Scorecard };
          if (j.scorecard) {
            setScorecard(j.scorecard);
            setPhase("ready");
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushLog]);

  // On mount: GET cache; if pending, leave phase=needs-run for user to confirm
  useEffect(() => {
    if (initialScorecard) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fluency/subagent");
        const j = (await res.json()) as
          | { scorecard: Scorecard }
          | { pending: true; corpus_sessions: number; corpus_user_turns: number }
          | { error: string };
        if (cancelled) return;
        if ("scorecard" in j) {
          setScorecard(j.scorecard);
          setPhase("ready");
        } else if ("pending" in j) {
          setMeta({ sessions: j.corpus_sessions, turns: j.corpus_user_turns });
          setPhase("needs-run");
        } else {
          setError(j.error ?? "Unknown");
          setPhase("error");
        }
      } catch (err) {
        setError((err as Error).message);
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [initialScorecard]);

  if (phase === "loading-cache") {
    return <ColumnSkeleton title="Subagent-LLM" status="Checking cache…" />;
  }
  if (phase === "needs-run") {
    return (
      <ColumnSkeleton
        title="Subagent-LLM"
        subtitle={meta.sessions ? `${meta.sessions} sessions · ${meta.turns} turns ready` : ""}
        status="Not yet generated for the current 30-day window."
        action={
          <button
            type="button"
            onClick={() => runStream(false)}
            style={{
              marginTop: 8,
              padding: "8px 14px",
              border: "1px solid var(--af-accent)",
              background: "var(--af-accent)",
              color: "white",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Generate scorecard (~30–70s, $0.01)
          </button>
        }
      />
    );
  }
  if (phase === "running") {
    const elapsed = Math.round((Date.now() - startedAt.current) / 1000);
    return (
      <ColumnSkeleton
        title="Subagent-LLM"
        subtitle={`Running… ${elapsed}s elapsed`}
        status="Calling Claude with the 4D AI Fluency Framework prompt."
        action={
          <ProgressList log={log} />
        }
      />
    );
  }
  if (phase === "error") {
    return (
      <ColumnSkeleton
        title="Subagent-LLM"
        status={`Failed: ${error}`}
        action={
          <button
            type="button"
            onClick={() => runStream(true)}
            style={{
              marginTop: 8,
              padding: "6px 12px",
              border: "1px solid var(--af-border-subtle)",
              background: "transparent",
              color: "var(--af-text)",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        }
      />
    );
  }
  if (phase === "ready" && scorecard) {
    return <ScorecardColumn scorecard={scorecard} onRefresh={() => runStream(true)} />;
  }
  return null;
}

/* ------------------------------------------------------------------ */

function ColumnSkeleton({
  title,
  subtitle,
  status,
  action,
}: {
  title: string;
  subtitle?: string;
  status: string;
  action?: React.ReactNode;
}) {
  return (
    <article
      style={{
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 12,
        padding: "16px 18px 18px",
        minHeight: 220,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>{title}</h2>
        <div style={{ fontSize: 22, fontWeight: 600, color: "var(--af-text-tertiary)", letterSpacing: "-0.01em" }}>
          — / 11
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", marginBottom: 12 }}>
        2 / 6 / 3 · pure LLM
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "var(--af-text-secondary)", marginBottom: 8, fontFamily: "var(--font-mono)" }}>
          {subtitle}
        </div>
      )}
      <div
        style={{
          padding: "10px 12px",
          background: "var(--background)",
          borderRadius: 6,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--af-text-secondary)",
        }}
      >
        {status}
      </div>
      {action}
    </article>
  );
}

function ProgressList({ log }: { log: ProgressLog }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: "8px 10px",
        background: "var(--background)",
        borderRadius: 6,
        fontSize: 11.5,
        lineHeight: 1.6,
        maxHeight: 220,
        overflow: "auto",
        fontFamily: "var(--font-mono)",
        color: "var(--af-text-secondary)",
      }}
    >
      {log.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 8 }}>
          <span style={{ color: "var(--af-accent)", flex: "0 0 auto", width: 60 }}>{l.phase}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function ScorecardColumn({ scorecard, onRefresh }: { scorecard: Scorecard; onRefresh: () => void }) {
  const glyph = (r: "+" | "~" | "-") => (r === "+" ? "[+]" : r === "~" ? "[~]" : "[-]");
  const tone = (r: "+" | "~" | "-") =>
    r === "+" ? "var(--af-success)" : r === "~" ? "var(--af-warning)" : "var(--af-danger)";
  return (
    <article
      style={{
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 12,
        padding: "16px 18px 18px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>Subagent-LLM</h2>
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--af-accent)",
            letterSpacing: "-0.01em",
          }}
        >
          {scorecard.score.numerator.toFixed(1)}{" "}
          <span style={{ fontSize: 14, color: "var(--af-text-tertiary)" }}>/ {scorecard.score.denominator}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", marginBottom: 4 }}>
        2 / 6 / 3 · pure LLM · {scorecard.corpus_user_turns} turns / {scorecard.corpus_sessions} sessions
      </div>
      {scorecard.llm && (
        <div style={{ marginBottom: 12, fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)", display: "flex", justifyContent: "space-between" }}>
          <span>
            Model: {scorecard.llm.model}
            {scorecard.llm.cost_usd !== null && ` · ~$${scorecard.llm.cost_usd.toFixed(4)}`}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            style={{
              background: "none",
              border: "none",
              color: "var(--af-text-secondary)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              textDecoration: "underline",
              cursor: "pointer",
              padding: 0,
            }}
          >
            refresh
          </button>
        </div>
      )}
      <p
        style={{
          margin: "0 0 14px",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--af-text-secondary)",
          padding: "8px 10px",
          background: "var(--background)",
          borderRadius: 6,
        }}
      >
        {scorecard.summary}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {scorecard.axes.map((a) => (
          <div
            key={a.id}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr",
              gap: 8,
              alignItems: "start",
              padding: "6px 0",
              borderBottom: "1px dashed var(--af-border-subtle)",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: tone(a.rating as "+" | "~" | "-"), fontWeight: 600 }}>
              {glyph(a.rating as "+" | "~" | "-")}
            </span>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", marginRight: 6, fontSize: 11 }}>
                  {a.id}
                </span>
                {a.title}
              </div>
              {a.evidence[0] && (
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 11.5,
                    color: "var(--af-text-secondary)",
                    lineHeight: 1.5,
                    fontStyle: "italic",
                  }}
                >
                  &ldquo;{a.evidence[0].quote.length > 110 ? a.evidence[0].quote.slice(0, 109) + "…" : a.evidence[0].quote}&rdquo;
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
