"use client";

import { useEffect, useState } from "react";
import { Check, AlertCircle, Loader2, Clock } from "lucide-react";
import Link from "next/link";

type Job = {
  id: string;
  kind: string;
  label: string;
  target: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  progress: { phase: string; index?: number; total?: number; bytes?: number; text?: string } | null;
  resultUrl: string | null;
  error: string | null;
  caller: "auto" | "user" | "cli";
};

const STORAGE_KEY = "cclens-jobs-widget-expanded";

export function JobQueueWidget() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Persist expansion state.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setExpanded(saved === "true");
    } catch { /* ignore */ }
  }, []);

  const setExpandedPersist = (v: boolean | ((prev: boolean) => boolean)) => {
    setExpanded((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Poll /api/jobs. Faster cadence when there's anything active. Empty
  // deps + closure-local `hasActive` — listing `jobs` here would re-run
  // the effect on every successful tick (because setJobs changes the
  // ref), collapsing the throttle into a tight 1–4 ms refetch loop.
  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let hasActive = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/jobs", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { jobs: Job[] };
        if (!mounted) return;
        setJobs(data.jobs);
        hasActive = data.jobs.some(j => j.status === "running" || j.status === "queued");
      } catch { /* ignore */ }
    };

    const schedule = () => {
      if (!mounted) return;
      timeoutId = setTimeout(async () => { await tick(); schedule(); }, hasActive ? 1500 : 6000);
    };

    void tick().then(schedule);
    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const active = jobs.filter(j => j.status === "running" || j.status === "queued");
  const recent = jobs.filter(j => j.status === "done" || j.status === "error" || j.status === "cancelled").slice(0, 8);

  // Hide entirely when nothing is active. Recent jobs are still accessible
  // by re-triggering an action; we don't want a permanent footer chip.
  if (active.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        // Sit to the LEFT of the live-sessions widget pill (~110px).
        // Anchored to the same bottom baseline so the two read as a row.
        right: 140,
        bottom: 20,
        zIndex: 99,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 6,
        maxWidth: 320,
        alignItems: "flex-end",
      }}
    >
      {/* Pill — always visible (we early-returned if no active). */}
      <button
        type="button"
        onClick={() => setExpandedPersist(v => !v)}
        title={`${active.length} job${active.length === 1 ? "" : "s"} running — click to ${expanded ? "collapse" : "expand"}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 11px 5px 9px",
          background: "rgba(66, 153, 225, 0.14)",
          border: "1px solid rgba(66, 153, 225, 0.4)",
          borderRadius: 100,
          fontSize: 10,
          fontWeight: 700,
          color: "#4299e1",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: "pointer",
          userSelect: "none",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          boxShadow: "0 2px 10px rgba(66, 153, 225, 0.15)",
          alignSelf: "flex-end",
        }}
      >
        <Loader2
          size={11}
          className="cs-job-spin"
          style={{ flexShrink: 0 }}
        />
        Jobs · {active.length}
      </button>

      {expanded && (
        <div
          style={{
            width: 320,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--af-surface-elevated)",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {active.length > 0 && (
            <div>
              <SectionLabel>Running</SectionLabel>
              {active.map(j => <JobRow key={j.id} job={j} />)}
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <SectionLabel>Recent</SectionLabel>
              {recent.map(j => <JobRow key={j.id} job={j} />)}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes cs-job-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .cs-job-spin {
          animation: cs-job-spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "6px 14px",
      fontSize: 9,
      color: "var(--af-text-tertiary)",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      fontWeight: 700,
      background: "var(--af-surface)",
    }}>
      {children}
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const Icon =
    job.status === "running" ? Loader2 :
    job.status === "queued"  ? Clock :
    job.status === "error"   ? AlertCircle :
                                Check;
  const iconColor =
    job.status === "running" ? "#4299e1" :
    job.status === "queued"  ? "var(--af-text-tertiary)" :
    job.status === "error"   ? "#f56565" :
                                "#48bb78";
  const isLink = job.resultUrl && (job.status === "done" || job.status === "running");
  const Container: React.ElementType = isLink ? Link : "div";
  const containerProps = isLink ? { href: job.resultUrl! } : {};

  return (
    <Container
      {...containerProps}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--af-border-subtle)",
        textDecoration: "none",
        color: "var(--af-text)",
        fontSize: 11.5,
        cursor: isLink ? "pointer" : "default",
      }}
    >
      <Icon
        size={13}
        className={job.status === "running" ? "cs-job-spin" : ""}
        style={{ color: iconColor, marginTop: 2, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {job.label}
        </div>
        {job.progress && (
          <div style={{
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            marginTop: 2,
            fontFamily: "var(--font-mono)",
          }}>
            {progressDescription(job.progress)}
          </div>
        )}
        {job.status === "error" && job.error && (
          <div style={{
            fontSize: 10,
            color: "#f56565",
            marginTop: 2,
          }}>
            {job.error.length > 60 ? job.error.slice(0, 60) + "…" : job.error}
          </div>
        )}
        {job.status === "done" && job.resultUrl && (
          <div style={{
            fontSize: 10,
            color: "var(--af-accent)",
            marginTop: 2,
          }}>
            View →
          </div>
        )}
      </div>
    </Container>
  );
}

function progressDescription(p: { phase: string; index?: number; total?: number; bytes?: number; text?: string }): string {
  if (p.index !== undefined && p.total !== undefined) {
    return `${p.phase} ${p.index}/${p.total}`;
  }
  if (p.bytes !== undefined) {
    const kb = (p.bytes / 1024).toFixed(1);
    return `${p.phase} · ${kb}k`;
  }
  if (p.text) return `${p.phase} · ${p.text}`;
  return p.phase;
}
