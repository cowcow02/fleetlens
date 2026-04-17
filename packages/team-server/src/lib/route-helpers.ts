import { NextRequest, NextResponse } from "next/server";
import type pg from "pg";
import { getPool } from "../db/pool.js";
import { validateAdminSession } from "./auth.js";

export type AdminContext = {
  memberId: string;
  sessionId: string;
  teamId: string;
  role: string;
  pool: pg.Pool;
};

export async function requireAdminSession(req: NextRequest): Promise<AdminContext | NextResponse> {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return { ...session, pool };
}

export function requireAdminRole(ctx: AdminContext): NextResponse | null {
  if (ctx.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  return null;
}
