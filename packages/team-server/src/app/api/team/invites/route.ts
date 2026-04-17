import { NextRequest, NextResponse } from "next/server";
import { createInvite } from "../../../../lib/members.js";
import { requireAdminSession } from "../../../../lib/route-helpers.js";

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const serverBaseUrl = process.env.BASE_URL || `${proto}://${host}`;

  try {
    const body = await req.json().catch(() => ({}));
    const result = await createInvite(body, ctx.memberId, ctx.teamId, serverBaseUrl, ctx.pool);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: err.message }, { status: 400 });
    }
    throw err;
  }
}
