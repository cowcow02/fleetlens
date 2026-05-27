import { Server, Laptop, Wifi, WifiOff, Clock, FolderOpen, Activity } from "lucide-react";
import {
  type RuntimeInfo,
  formatAgentTime,
  formatRelativeMs,
} from "@/lib/fleet-data";
import { getAgentMetadata, type AgentKind } from "@claude-lens/parser";

const NEW_SNAPSHOT_FRESH_MS = 5 * 60 * 1000; // 5 min — peer push runs at 60s
const LIVE_PEER_FRESH_MS = 90 * 1000;        // ~3× ping interval

function agentColor(kind: string): string {
  const meta = getAgentMetadata(kind as AgentKind);
  return meta?.accentColor ?? "var(--af-text-tertiary)";
}

function agentLabel(kind: string): string {
  const meta = getAgentMetadata(kind as AgentKind);
  return meta?.displayName ?? kind;
}

export function RuntimeCard({ runtime }: { runtime: RuntimeInfo }) {
  const now = Date.now();
  const snapshotAgeMs = now - Date.parse(runtime.capturedAt);
  const snapshotStale = snapshotAgeMs > NEW_SNAPSHOT_FRESH_MS;

  const lastSeenAgeMs = runtime.connection
    ? now - Date.parse(runtime.connection.lastSeen)
    : null;
  const peerLive = lastSeenAgeMs !== null && lastSeenAgeMs < LIVE_PEER_FRESH_MS;

  const title = runtime.label ?? (runtime.isLocal ? "this machine" : runtime.deviceId);

  // A "stub" runtime = remote peer we're connected to but who hasn't
  // returned a full RuntimeInfo (typically: peer is on an older build
  // that doesn't have getInfo yet). Treat the stats as unknown, not zero.
  const isStub =
    !runtime.isLocal &&
    runtime.agentSources.length === 0 &&
    runtime.recentProjects.length === 0 &&
    runtime.stats.totalSessions === 0 &&
    !runtime.fleetlensVersion;

  return (
    <div className="af-card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: runtime.isLocal
              ? "color-mix(in srgb, var(--af-accent) 14%, transparent)"
              : "color-mix(in srgb, var(--af-text-secondary) 10%, transparent)",
            color: runtime.isLocal ? "var(--af-accent)" : "var(--af-text-secondary)",
            flex: "0 0 36px",
          }}
        >
          {runtime.isLocal ? <Laptop size={18} /> : <Server size={18} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--af-text-primary)" }}>{title}</span>
            {runtime.isLocal ? (
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "color-mix(in srgb, var(--af-accent) 14%, transparent)",
                  color: "var(--af-accent)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                this machine
              </span>
            ) : (
              <RuntimeBadge
                live={peerLive}
                title={
                  runtime.connection
                    ? `Last contact ${formatRelativeMs(lastSeenAgeMs ?? 0)}`
                    : "No connection"
                }
              />
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--af-text-tertiary)",
              marginTop: 2,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span>{runtime.deviceId}</span>
            {runtime.hostname && <span>• {runtime.hostname}</span>}
            {runtime.fleetlensVersion && <span>• v{runtime.fleetlensVersion}</span>}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      {isStub ? (
        <div
          style={{
            padding: "10px 12px",
            background: "color-mix(in srgb, var(--af-text-tertiary) 8%, transparent)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--af-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          Peer is connected but hasn&apos;t returned activity stats yet — this
          usually means they&apos;re running an older fleetlens build without
          the runtimes data plane. They&apos;ll appear with full stats once
          they upgrade.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 10,
          }}
        >
          <StatCell label="Sessions 24h" value={runtime.stats.sessionsLast24h} />
          <StatCell label="Sessions 7d" value={runtime.stats.sessionsLast7d} />
          <StatCell label="Agent time 24h" value={formatAgentTime(runtime.stats.agentTimeLast24hMs)} />
          <StatCell label="Agent time 7d" value={formatAgentTime(runtime.stats.agentTimeLast7dMs)} />
        </div>
      )}

      {/* Agent source breakdown */}
      {runtime.agentSources.some((s) => s.totalSessions > 0) && (
        <div>
          <Label icon={<Activity size={11} />}>Agent sources</Label>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {runtime.agentSources
              .filter((s) => s.totalSessions > 0)
              .map((s) => (
                <span
                  key={s.kind}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    border: `1px solid color-mix(in srgb, ${agentColor(s.kind)} 30%, transparent)`,
                    color: agentColor(s.kind),
                    background: `color-mix(in srgb, ${agentColor(s.kind)} 8%, transparent)`,
                  }}
                  title={`${s.totalSessions} total · ${s.sessionsLast24h} in last 24h`}
                >
                  <span style={{ fontWeight: 600 }}>{agentLabel(s.kind)}</span>
                  <span style={{ opacity: 0.75 }}>{s.totalSessions}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Recent projects */}
      {runtime.recentProjects.length > 0 && (
        <div>
          <Label icon={<FolderOpen size={11} />}>Active projects (7d)</Label>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {runtime.recentProjects.slice(0, 5).map((p) => (
              <li
                key={p.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12,
                  color: "var(--af-text-secondary)",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-mono)",
                  }}
                  title={p.name}
                >
                  {shortName(p.name)}
                </span>
                <span style={{ color: "var(--af-text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                  {p.sessionCount}× · {formatAgentTime(p.agentTimeMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          gap: 14,
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          paddingTop: 8,
          borderTop: "1px solid var(--af-border-subtle)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Clock size={11} />
          Last activity{" "}
          {runtime.stats.lastActivityAt
            ? formatRelativeMs(now - Date.parse(runtime.stats.lastActivityAt))
            : "—"}
        </span>
        <span style={{ marginLeft: "auto", color: snapshotStale ? "var(--af-warn, #d97706)" : undefined }}>
          {snapshotStale ? "snapshot stale" : `snapshot ${formatRelativeMs(snapshotAgeMs)}`}
        </span>
      </div>
    </div>
  );
}

function RuntimeBadge({ live, title }: { live: boolean; title: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 4,
        background: live ? "color-mix(in srgb, #22c55e 16%, transparent)" : "color-mix(in srgb, var(--af-text-tertiary) 14%, transparent)",
        color: live ? "#16a34a" : "var(--af-text-tertiary)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
      title={title}
    >
      {live ? <Wifi size={10} /> : <WifiOff size={10} />}
      {live ? "connected" : "stale"}
    </span>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--af-bg-subtle, color-mix(in srgb, var(--af-text-primary) 4%, transparent))",
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Label({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        color: "var(--af-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 600,
      }}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

function shortName(p: string): string {
  // /Users/me/code/foo  →  foo
  // /home/user/repo     →  repo
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}
