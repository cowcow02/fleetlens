import { pruneIngestLog, pruneMemberSyncLog } from "../../../../lib/scheduler";

export async function POST(req: Request) {
  const secret = process.env.FLEETLENS_SCHEDULER_SECRET;
  if (!secret) {
    return Response.json({ error: "scheduler secret not configured" }, { status: 503 });
  }
  if (req.headers.get("x-scheduler-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }
  const pruned = await pruneIngestLog();
  const prunedSyncLog = await pruneMemberSyncLog();
  return Response.json({ pruned, prunedSyncLog });
}
