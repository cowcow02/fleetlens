import { killRun } from "@/lib/agent/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  killRun(id);
  return Response.json({ ok: true });
}
