"use client";

import { useState } from "react";
import type { MinimapIdleBand } from "./adapter";
import { LABEL_WIDTH } from "./minimap-shared";

export function IdleBandOverlay({ band }: { band: MinimapIdleBand }) {
  const [hovered, setHovered] = useState(false);
  const left = band.xFracStart * 100;
  const width = Math.max(0.5, (band.xFracEnd - band.xFracStart) * 100);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: `calc(${LABEL_WIDTH}px + ${left}% * (100% - ${LABEL_WIDTH}px) / 100%)`,
        width: `calc(${width}% * (100% - ${LABEL_WIDTH}px) / 100%)`,
        background:
          "repeating-linear-gradient(135deg, transparent 0, transparent 4px, var(--af-border-subtle) 4px, var(--af-border-subtle) 6px)",
        zIndex: 1,
        cursor: "help",
      }}
    >
      {hovered && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "calc(100% + 6px)",
            transform: "translateX(-50%)",
            background: "#0F172A",
            color: "#F1F5F9",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(15,23,42,0.22)",
            zIndex: 20,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 1 }}>Idle</div>
          <div style={{ opacity: 0.78, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
            {band.label}
          </div>
        </div>
      )}
    </div>
  );
}
