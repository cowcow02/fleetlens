/**
 * On-demand loader for a single workflow-spawned agent's full transcript —
 * the ordered step list, full prompt, and final result. Lazy-fetched by the
 * Workflows tab when an agent row is expanded, so a 200-agent session's detail
 * page never parses 200 transcripts up front.
 *
 * GET /api/workflow-agent?session=<id>&run=<runId>&agent=<agentId>
 */
import { loadWorkflowAgentDetail } from "@claude-lens/parser/fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const session = url.searchParams.get("session");
  const run = url.searchParams.get("run");
  const agent = url.searchParams.get("agent");
  if (!session || !run || !agent) {
    return Response.json({ error: "session, run and agent are required" }, { status: 400 });
  }
  const detail = await loadWorkflowAgentDetail(session, run, agent);
  if (!detail) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json(detail);
}
