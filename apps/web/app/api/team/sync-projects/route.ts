import { readTeamConfig, writeTeamConfig } from "@/lib/team-config";
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

export async function PUT(req: Request): Promise<Response> {
  const config = readTeamConfig();
  if (!config) return Response.json({ error: "Not paired with a team." }, { status: 409 });
  const parsed = SyncProjectsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  // Spread the whole parsed config (not field-by-field) so unknown/future
  // fields survive a PUT from an older client build.
  writeTeamConfig({ ...config, syncProjects: parsed.data });
  return Response.json({ ok: true });
}
