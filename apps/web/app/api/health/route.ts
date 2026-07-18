import { NextResponse } from "next/server";
import pkg from "../../../package.json" with { type: "json" };

export const runtime = "nodejs";
// Never static: a prerendered body could be served without proving the
// runtime is actually alive, and the daemon watchdog probes this route to
// detect event-loop wedges (GC livelock, 2026-07-18).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, version: pkg.version });
}
