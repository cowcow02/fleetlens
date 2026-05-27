/**
 * /runtimes — one card per machine in the fleet.
 *
 * Reads ~/.cclens/fleet/runtimes.json, which the fleet worker maintains by
 * periodically calling `getInfo` on every connected peer and unioning the
 * results with this machine's own RuntimeInfo.
 *
 * Three render states:
 *   - Fleet not configured  → "set up a fleet" call-to-action with CLI hints
 *   - Worker not running    → orange banner, plus whatever cached data exists
 *   - Worker running        → live grid of runtime cards
 */

import Link from "next/link";
import { Network, AlertTriangle, RefreshCw } from "lucide-react";
import { readFleetState, formatRelativeMs } from "@/lib/fleet-data";
import { RuntimeCard } from "@/components/runtime-card";

export const dynamic = "force-dynamic";

export default async function RuntimesPage() {
  const state = readFleetState();

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ marginBottom: 22, display: "flex", alignItems: "center", gap: 12 }}>
        <Network size={20} style={{ color: "var(--af-accent)" }} />
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Fleet runtimes</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--af-text-tertiary)" }}>
            Every machine you&apos;ve paired with — local activity rolled up under one view.
          </p>
        </div>
        {state.configured && state.snapshotAgeMs !== null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--af-text-tertiary)",
            }}
            title={`Snapshot ${formatRelativeMs(state.snapshotAgeMs)}`}
          >
            <RefreshCw size={12} />
            updated {formatRelativeMs(state.snapshotAgeMs)}
          </span>
        )}
      </header>

      {!state.configured && <NotConfigured />}

      {state.configured && !state.workerRunning && (
        <Banner
          icon={<AlertTriangle size={14} />}
          color="#d97706"
          title="Fleet worker not running"
        >
          The fleet swarm worker isn&apos;t running on this machine, so peer
          discovery is paused and the data below may be stale. Start it with:{" "}
          <code style={codeChip}>fleetlens fleet start</code>
        </Banner>
      )}

      {state.configured && (!state.snapshot || state.snapshot.runtimes.length === 0) && (
        <EmptyState workerRunning={state.workerRunning} />
      )}

      {state.configured && state.snapshot && state.snapshot.runtimes.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          {state.snapshot.runtimes.map((r) => (
            <RuntimeCard key={r.publicKey || r.deviceId} runtime={r} />
          ))}
        </div>
      )}

      <Footnote />
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="af-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>No fleet on this machine yet</h2>
      <p style={{ margin: 0, fontSize: 13, color: "var(--af-text-secondary)", lineHeight: 1.55 }}>
        A fleet lets multiple machines running Fleetlens find each other directly
        — no central server, no account. Sessions and projects from every paired
        machine show up here so you have one view across your laptops + Railway
        daemon + work box.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Step n={1} title="Create a fleet on this machine">
          <code style={codeBlock}>fleetlens fleet init --label &quot;my-laptop&quot;</code>
        </Step>
        <Step n={2} title="On every other machine, run">
          <code style={codeBlock}>fleetlens fleet join &lt;join-code&gt; --label &quot;other-machine&quot;</code>
        </Step>
        <Step n={3} title="Come back to this page and see them all here.">
          <span />
        </Step>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--af-text-tertiary)" }}>
        Pairing uses Hyperswarm — peers find each other on a DHT, identity is
        Noise-authenticated, secrets stay on disk under{" "}
        <code style={codeChip}>~/.cclens/fleet/</code>.
      </p>
    </div>
  );
}

function EmptyState({ workerRunning }: { workerRunning: boolean }) {
  return (
    <div
      className="af-card"
      style={{
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: "var(--af-text-secondary)",
      }}
    >
      <strong style={{ fontSize: 14 }}>Waiting for the first runtime snapshot…</strong>
      <span style={{ fontSize: 13, color: "var(--af-text-tertiary)" }}>
        {workerRunning
          ? "The fleet worker writes ~/.cclens/fleet/runtimes.json a few seconds after startup. Refresh the page in a moment."
          : "The fleet worker isn't running. Start it with the command above."}
      </span>
    </div>
  );
}

function Banner({
  icon,
  color,
  title,
  children,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="af-card"
      style={{
        padding: "12px 16px",
        marginBottom: 16,
        borderLeft: `3px solid ${color}`,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <span style={{ color, marginTop: 2 }}>{icon}</span>
      <div style={{ fontSize: 13, color: "var(--af-text-secondary)" }}>
        <strong style={{ color: "var(--af-text-primary)" }}>{title}.</strong> {children}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "color-mix(in srgb, var(--af-accent) 16%, transparent)",
          color: "var(--af-accent)",
          fontSize: 11,
          fontWeight: 700,
          flex: "0 0 20px",
          marginTop: 1,
        }}
      >
        {n}
      </span>
      <div style={{ flex: 1, fontSize: 13, color: "var(--af-text-primary)" }}>
        <div style={{ marginBottom: 4 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function Footnote() {
  return (
    <p style={{ marginTop: 24, fontSize: 11, color: "var(--af-text-tertiary)" }}>
      Runtimes refresh every ~60 seconds. Each peer&apos;s data is pulled directly over a
      Noise-authenticated stream — no third-party servers in the path.{" "}
      <Link href="/sessions" style={{ color: "var(--af-text-secondary)" }}>
        All sessions
      </Link>{" "}
      still scopes to this machine for now.
    </p>
  );
}

const codeChip: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  padding: "1px 5px",
  background: "color-mix(in srgb, var(--af-text-primary) 6%, transparent)",
  borderRadius: 3,
};

const codeBlock: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "8px 12px",
  background: "color-mix(in srgb, var(--af-text-primary) 6%, transparent)",
  borderRadius: 4,
  marginTop: 4,
  whiteSpace: "pre-wrap",
};
