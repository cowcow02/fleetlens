import { deleteChat, readChat } from "@/lib/agent/chat-store";
import { discardRun, reconcileChat } from "@/lib/agent/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = readChat(id);
  if (!chat) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(reconcileChat(chat));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  discardRun(id);
  deleteChat(id);
  return new Response(null, { status: 204 });
}
