"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export function ExportPdfButton({ digestKey }: { digestKey: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/pdf/${digestKey}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      // Trust the server's Content-Disposition for the filename so we don't
      // drift across the midnight boundary between request and response.
      const filename = parseDispositionFilename(res.headers.get("content-disposition"))
        ?? `fleetlens-${digestKey}.pdf`;
      triggerDownload(blob, filename);
      setStatus("idle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("error");
    }
  }

  const disabled = status === "loading";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={onClick}
        disabled={disabled}
        title={error ?? "Download as PDF"}
        style={{
          padding: "2px 8px",
          background: "transparent",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 4,
          fontSize: 10,
          color: status === "error" ? "#f56565" : "var(--af-text-secondary)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Download size={11} />
        {status === "loading" ? "Exporting…" : status === "error" ? "Retry PDF" : "PDF"}
      </button>
    </span>
  );
}

function parseDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="([^"]+)"/.exec(header) ?? /filename=([^;]+)/.exec(header);
  return m ? m[1].trim() : null;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
