import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireAdminRole } from "../../../../../lib/route-helpers.js";
import { encryptAesGcm } from "../../../../../lib/crypto.js";

export async function PUT(req: NextRequest) {
  const ctx = await requireAdminSession(req);
  if (ctx instanceof NextResponse) return ctx;
  const roleErr = requireAdminRole(ctx);
  if (roleErr) return roleErr;

  const encKey = process.env.FLEETLENS_ENCRYPTION_KEY;
  if (!encKey) {
    return NextResponse.json(
      { error: "FLEETLENS_ENCRYPTION_KEY env var must be set to store Resend keys at rest" },
      { status: 501 },
    );
  }

  const { apiKey } = await req.json();
  if (!apiKey) return NextResponse.json({ error: "API key required" }, { status: 400 });

  const validate = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!validate.ok) return NextResponse.json({ error: "Invalid Resend API key" }, { status: 400 });

  const encrypted = encryptAesGcm(apiKey, encKey);
  await ctx.pool.query(
    "UPDATE teams SET resend_api_key_enc = $1 WHERE id = $2",
    [encrypted, ctx.teamId],
  );
  return NextResponse.json({ saved: true });
}
