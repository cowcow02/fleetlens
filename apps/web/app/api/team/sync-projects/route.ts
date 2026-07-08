import { readTeamConfig, writeTeamConfig, type TeamConfig } from "@/lib/team-config";
import { SyncProjectsSchema, listSyncProjectRows } from "@/lib/sync-projects-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = readTeamConfig();
  if (!config) return Response.json({ paired: false, setupPending: false, projects: [], syncProjects: null });
  return Response.json({
    paired: true,
    setupPending: config.setupPending ?? false,
    projects: await listSyncProjectRows(),
    syncProjects: config.syncProjects ?? null,
  });
}

const sameSelection = (a: TeamConfig["syncProjects"], b: TeamConfig["syncProjects"]) =>
  !!a &&
  !!b &&
  a.autoIncludeNew === b.autoIncludeNew &&
  [...a.included].sort().join("\n") === [...b.included].sort().join("\n") &&
  [...a.excluded].sort().join("\n") === [...b.excluded].sort().join("\n");

export async function PUT(req: Request): Promise<Response> {
  const config = readTeamConfig();
  if (!config) return Response.json({ error: "Not paired with a team." }, { status: 409 });
  const parsed = SyncProjectsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  // A changed selection must correct HISTORY, not just future days: rewind
  // the watermark so the next sync re-pushes every day under the new filter
  // (per-day upserts replace rows; excluded-only days get tombstoned).
  const resync = !sameSelection(config.syncProjects, parsed.data) && !config.setupPending;
  // Spread the whole parsed config (not field-by-field) so unknown/future
  // fields survive a PUT from an older client build.
  const { lastSyncedDay, ...rest } = config;
  writeTeamConfig({ ...rest, ...(resync ? {} : lastSyncedDay ? { lastSyncedDay } : {}), syncProjects: parsed.data });
  return Response.json({ ok: true, resync });
}
