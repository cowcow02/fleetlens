import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNS_DIR = cclensPath("llm-runs");

/**
 * GET /api/runs/<runId>           dump the full event trace
 * GET /api/runs/latest            shorthand: most recent trace
 * GET /api/runs/<prefix>          unique-prefix match if no exact runId match
 */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }): Promise<Response> {
  const { runId } = await ctx.params;
  if (!existsSync(RUNS_DIR)) {
    return new Response(JSON.stringify({ error: "no traces" }), { status: 404, headers: { "content-type": "application/json" } });
  }

  let path: string | null = null;
  let resolvedId = runId;

  if (runId === "latest") {
    const all = readdirSync(RUNS_DIR)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({ id: f.replace(/\.jsonl$/, ""), path: join(RUNS_DIR, f), mtime: statSync(join(RUNS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (all.length === 0) {
      return new Response(JSON.stringify({ error: "no traces" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    path = all[0]!.path;
    resolvedId = all[0]!.id;
  } else {
    const exact = join(RUNS_DIR, `${runId}.jsonl`);
    if (existsSync(exact)) {
      path = exact;
    } else {
      const matches = readdirSync(RUNS_DIR)
        .filter(f => f.endsWith(".jsonl") && f.includes(runId))
        .map(f => f.replace(/\.jsonl$/, ""));
      if (matches.length === 1) {
        path = join(RUNS_DIR, `${matches[0]}.jsonl`);
        resolvedId = matches[0]!;
      } else if (matches.length > 1) {
        return new Response(JSON.stringify({ error: "ambiguous", matches }), { status: 400, headers: { "content-type": "application/json" } });
      }
    }
  }

  if (!path) {
    return new Response(JSON.stringify({ error: "not found", runId }), { status: 404, headers: { "content-type": "application/json" } });
  }

  const lines = readFileSync(path, "utf-8").split("\n").filter(l => l.trim());
  const events: unknown[] = lines.map(l => {
    try { return JSON.parse(l); } catch { return { _raw: l }; }
  });

  return new Response(JSON.stringify({ run_id: resolvedId, events }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
