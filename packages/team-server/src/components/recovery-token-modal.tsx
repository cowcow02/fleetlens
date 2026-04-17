"use client";

export function RecoveryTokenModal({
  recoveryToken,
  onDismiss,
}: {
  recoveryToken: string;
  onDismiss: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{ background: "white", borderRadius: 8, padding: 32, maxWidth: 480, width: "100%" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Save Your Recovery Token</h2>
        <p style={{ color: "#6b7280", marginBottom: 16 }}>
          This is your only way to recover admin access if you lose your session. Save it somewhere safe — it is shown only once.
        </p>
        <code style={{
          display: "block", padding: 12, background: "#f3f4f6", borderRadius: 4,
          fontFamily: "monospace", fontSize: 14, wordBreak: "break-all", marginBottom: 16,
        }}>
          {recoveryToken}
        </code>
        <button
          onClick={onDismiss}
          style={{ width: "100%", padding: 12, background: "#111", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
          I've Saved It
        </button>
      </div>
    </div>
  );
}
