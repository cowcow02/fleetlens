"use client";

import { useState } from "react";
import type { TimelineData } from "./adapter";
import { TeamMinimap } from "./team-minimap";
import { TeamTable } from "./team-table";

export function TeamTabClient({
  initial,
  teamName,
}: {
  initial: TimelineData;
  teamName: string;
}) {
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  const [seekTargetMs, setSeekTargetMs] = useState<number | null>(null);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 16,
        height: "calc(100vh - 200px)",
        minHeight: 600,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          Team: {teamName}
        </h2>
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          {initial.tracks.length} agent{initial.tracks.length === 1 ? "" : "s"}
        </div>
      </div>
      <TeamMinimap
        data={initial}
        playheadMs={playheadMs}
        onSeek={(ts) => setSeekTargetMs(ts)}
      />
      <TeamTable
        data={initial}
        onPlayheadChange={setPlayheadMs}
        scrollTargetMs={seekTargetMs}
      />
    </div>
  );
}
