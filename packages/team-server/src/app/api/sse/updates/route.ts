import { NextRequest } from "next/server";
import { addClient } from "../../../../lib/sse.js";
import { validateAdminSession } from "../../../../lib/auth.js";
import { getPool } from "../../../../db/pool.js";

export async function GET(req: NextRequest) {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) {
    return new Response("Unauthorized", { status: 401 });
  }
  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const memberRes = await pool.query("SELECT team_id FROM members WHERE id = $1", [session.memberId]);
  if (!memberRes.rowCount) return new Response("Not found", { status: 404 });
  const teamId = memberRes.rows[0].team_id;

  const stream = new ReadableStream({
    start(controller) {
      const remove = addClient(controller, teamId);
      req.signal.addEventListener("abort", remove);

      // Heartbeat every 15s
      const hb = setInterval(() => {
        try { controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")); }
        catch { clearInterval(hb); remove(); }
      }, 15000);

      req.signal.addEventListener("abort", () => clearInterval(hb));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
