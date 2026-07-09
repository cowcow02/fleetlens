import { NextResponse } from "next/server";
import {
  readCredentialsMasked,
  writeZaiKey,
  deleteZaiKey,
  validateAndSnapshotZaiKey,
} from "@claude-lens/entries/node";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(readCredentialsMasked());
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({ api_key: undefined })) as {
    api_key?: string;
  };
  if (typeof body.api_key !== "string") {
    return NextResponse.json({ error: '"api_key" (string) is required' }, { status: 400 });
  }
  const key = body.api_key.trim();
  if (key) {
    // Validate against the live Z.ai API BEFORE persisting. A bad/expired/
    // malformed key must not be saved as "configured" — and on success we
    // immediately snapshot the real usage so the /usage tab + menu-bar
    // widget are populated the instant the user saves, without waiting for
    // the daemon's next 5-min tick.
    try {
      await validateAndSnapshotZaiKey(key);
    } catch (err) {
      return NextResponse.json(
        { error: `Invalid Z.ai API key: ${(err as Error).message}` },
        { status: 400 },
      );
    }
    writeZaiKey(key);
  } else {
    deleteZaiKey();
  }
  return NextResponse.json({ ok: true, ...readCredentialsMasked() });
}
