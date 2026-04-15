"use client";

import { useMemo, useState } from "react";
import type { TimelineData, TeamTurn } from "./adapter";
import type { SeekTarget } from "./team-table";
import { TeamTable } from "./team-table";
import { DEFAULT_VISIBLE_LANES } from "./team-minimap";
import { TurnDrawer } from "./turn-drawer";

export function TeamTabClient({
  initial,
  teamName,
  playheadMs,
  onPlayheadChange,
  seekTarget,
  expanded,
}: {
  initial: TimelineData;
  teamName: string;
  /** Current playhead — owned by session-view so the sticky TeamMinimap
   *  and the table body stay in sync without a duplicated minimap inside
   *  the tab. The body publishes its top-of-viewport ms via onPlayheadChange. */
  playheadMs: number | null;
  onPlayheadChange: (tsMs: number | null) => void;
  /** Click on the sticky minimap → request the table to scroll. */
  seekTarget: SeekTarget | null;
  /** Whether the minimap is showing all lanes (true) or just the first
   *  DEFAULT_VISIBLE_LANES (false). Table columns track the same state. */
  expanded: boolean;
}) {
  const [selectedTurn, setSelectedTurn] = useState<TeamTurn | null>(null);

  const visibleTrackIds = useMemo(() => {
    const ids = expanded
      ? initial.tracks.map((t) => t.id)
      : initial.tracks.slice(0, DEFAULT_VISIBLE_LANES).map((t) => t.id);
    return new Set(ids);
  }, [expanded, initial.tracks]);

  const selectedTrack = selectedTurn
    ? initial.tracks.find((t) => t.id === selectedTurn.trackId)
    : null;

  // playheadMs is owned by the parent; it isn't read here directly but
  // the prop exists so future drawer/highlight features can consume it.
  void playheadMs;

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
      <TeamTable
        data={initial}
        onPlayheadChange={onPlayheadChange}
        scrollTarget={seekTarget}
        onTurnClick={setSelectedTurn}
        visibleTrackIds={visibleTrackIds}
      />
      <TurnDrawer
        turn={selectedTurn}
        trackLabel={
          selectedTrack
            ? selectedTrack.isLead
              ? "LEAD"
              : selectedTrack.label
            : ""
        }
        trackColor={selectedTrack?.color ?? "#888"}
        onClose={() => setSelectedTurn(null)}
      />
    </div>
  );
}
