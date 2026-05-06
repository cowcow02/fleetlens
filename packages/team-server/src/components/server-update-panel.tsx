import type { UpdateStatus } from "../lib/self-update/service";

export function ServerUpdatePanel({ status }: { status: UpdateStatus }) {
  const hasUpdate = status.updateAvailable && status.latestVersion;
  const lastChecked = status.lastCheckedAt
    ? new Date(status.lastCheckedAt).toLocaleString()
    : "never";

  return (
    <section
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 4,
        padding: "16px 20px",
        marginBottom: 24,
        background: hasUpdate ? "var(--accent-soft)" : "var(--paper)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <h3
          className="mono"
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: hasUpdate ? "var(--accent)" : "var(--mute)",
            margin: 0,
            fontWeight: 600,
          }}
        >
          Server update
        </h3>
        {hasUpdate && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: 99,
              background: "var(--accent)",
              color: "var(--paper)",
              letterSpacing: "0.06em",
            }}
          >
            available
          </span>
        )}
      </div>

      {hasUpdate ? (
        <p style={{ margin: "0 0 10px", fontSize: 14 }}>
          Team-server <span className="mono">v{status.latestVersion}</span> is
          available. You're running{" "}
          <span className="mono">v{status.currentVersion}</span>.
        </p>
      ) : (
        <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--mute)" }}>
          Running <span className="mono">v{status.currentVersion}</span>
          {status.latestVersion && status.latestVersion !== status.currentVersion ? (
            <> · latest known <span className="mono">v{status.latestVersion}</span></>
          ) : (
            <> · up to date</>
          )}
          .
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 12,
          color: "var(--mute)",
        }}
      >
        <span>Last checked: {lastChecked}</span>
        {hasUpdate && (
          <a
            href={`/admin/updates/${status.latestVersion}`}
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            Review update →
          </a>
        )}
        <a
          href="/admin/updates"
          style={{ color: "var(--mute)", textDecoration: "underline" }}
        >
          Open admin
        </a>
      </div>
    </section>
  );
}
