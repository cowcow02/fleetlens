"use client";

import { useState } from "react";
import type { TimelineData, TeamTurn } from "./adapter";
import { TimelineCanvas } from "./timeline-canvas";
import { TurnDrawer } from "./turn-drawer";

export function TeamTabClient({
  initial,
  teamName,
}: {
  initial: TimelineData;
  teamName: string;
}) {
  const [selectedTurn, setSelectedTurn] = useState<TeamTurn | null>(null);

  const selectedTrack = selectedTurn
    ? initial.tracks.find((t) => t.id === selectedTurn.trackId)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Team: {teamName}</h2>
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          {initial.tracks.length} agent{initial.tracks.length === 1 ? "" : "s"} · click a
          turn to inspect
        </div>
      </div>
      <TimelineCanvas data={initial} onTurnClick={setSelectedTurn} />
      <TurnDrawer
        turn={selectedTurn}
        trackLabel={selectedTrack?.isLead ? "LEAD" : (selectedTrack?.label ?? "")}
        onClose={() => setSelectedTurn(null)}
      />
    </div>
  );
}
