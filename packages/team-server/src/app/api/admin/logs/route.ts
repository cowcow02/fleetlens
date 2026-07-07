import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/route-helpers";
import { readLog } from "../../../../lib/log-buffer";

export const dynamic = "force-dynamic";

// Raw application log tail. Staff-only: the buffer holds every team's log lines
// (member/team ids, stack traces), so this is a server-operator tool, not a
// team-admin one.
export async function GET(req: NextRequest) {
  const ctx = await requireStaff(req);
  if (ctx instanceof NextResponse) return ctx;

  const sp = req.nextUrl.searchParams;
  const after = Number(sp.get("after")) || 0;
  const limitRaw = Number(sp.get("limit")) || 1000;
  const limit = Math.min(Math.max(limitRaw, 1), 2000);
  const levelParam = sp.get("level");
  const level = levelParam === "warn" || levelParam === "error" ? levelParam : "all";
  const q = sp.get("q")?.trim() || undefined;

  return NextResponse.json(readLog({ after, limit, level, q }));
}
