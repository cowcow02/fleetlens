import "server-only";
import { z } from "zod";
import { listSessions } from "@/lib/data";
import { groupByProject } from "@claude-lens/parser";

export const SyncProjectsSchema = z.object({
  autoIncludeNew: z.boolean(),
  included: z.array(z.string().min(1)).max(5000),
  excluded: z.array(z.string().min(1)).max(5000),
});

export type SyncProjectRow = {
  name: string;
  sessions: number;
  agentTimeMs: number;
  lastActiveMs: number | null;
  worktreeCount: number;
};

export async function listSyncProjectRows(): Promise<SyncProjectRow[]> {
  return groupByProject(await listSessions())
    .map((p) => ({
      name: p.projectName,
      sessions: p.sessions.length,
      agentTimeMs: p.metrics.totalAirTimeMs,
      lastActiveMs: p.lastActiveMs ?? null,
      worktreeCount: p.worktreeCount,
    }))
    // Most agent time first: the projects a user actually needs to decide
    // about sit at the top of the picker. Agent time beats session count as
    // the signal — many tiny sessions ≠ real work.
    .sort((a, b) => b.agentTimeMs - a.agentTimeMs);
}
