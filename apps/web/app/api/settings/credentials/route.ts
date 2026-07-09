import { NextResponse } from "next/server";
import { readCredentialsMasked, writeZaiKey, deleteZaiKey } from "@claude-lens/entries/node";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(readCredentialsMasked());
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({ api_key: undefined })) as { api_key?: string };
  if (typeof body.api_key !== "string") {
    return NextResponse.json({ error: '"api_key" (string) is required' }, { status: 400 });
  }
  const key = body.api_key.trim();
  if (key) {
    writeZaiKey(key);
  } else {
    deleteZaiKey();
  }
  return NextResponse.json({ ok: true, ...readCredentialsMasked() });
}
