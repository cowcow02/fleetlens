import { NextResponse } from "next/server";
import { z } from "zod";
import { readTeamConfig, writeTeamConfig, toTeamConfigView } from "@/lib/team-config";

export const runtime = "nodejs";

const UpdateSchema = z.object({
  enrichmentOptIn: z.boolean().optional(),
  privateProjects: z.array(z.string()).max(500).optional(),
});

export async function GET() {
  const c = readTeamConfig();
  if (!c) return NextResponse.json({ paired: false });
  return NextResponse.json({ paired: true, config: toTeamConfigView(c) });
}

export async function PUT(req: Request) {
  const c = readTeamConfig();
  if (!c) return NextResponse.json({ error: "not paired" }, { status: 404 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = UpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const next = { ...c };
  if (parsed.data.enrichmentOptIn !== undefined) next.enrichmentOptIn = parsed.data.enrichmentOptIn;
  if (parsed.data.privateProjects !== undefined) next.privateProjects = parsed.data.privateProjects;
  writeTeamConfig(next);
  return NextResponse.json({ ok: true, config: toTeamConfigView(next) });
}
