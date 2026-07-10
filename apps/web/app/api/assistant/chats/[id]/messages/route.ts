import { readSettings } from "@claude-lens/entries/node";
import { chatTitle, newAssistantMessage, readChat, writeChat } from "@/lib/assistant/chat-store";
import { MAX_CONCURRENT_RUNS, activeRunCount, getRun, reconcileChat, startRun } from "@/lib/assistant/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { text?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });

  let chat = readChat(id);
  if (!chat) return Response.json({ error: "not found" }, { status: 404 });
  chat = reconcileChat(chat);
  if (getRun(id)) return Response.json({ error: "a run is already active for this chat" }, { status: 409 });
  if (activeRunCount() >= MAX_CONCURRENT_RUNS) {
    return Response.json({ error: `at most ${MAX_CONCURRENT_RUNS} chats can run at once` }, { status: 429 });
  }

  const isFirst = !chat.messages.some((m) => m.role === "user");
  chat = {
    ...chat,
    title: isFirst ? chatTitle(text) : chat.title,
    status: "running",
    updated_at: new Date().toISOString(),
    // The empty assistant message anchors the run's segments — the reducer
    // always appends to the trailing assistant message.
    messages: [...chat.messages, { role: "user", text }, newAssistantMessage()],
  };
  writeChat(chat);

  startRun(chat, {
    model: body.model || readSettings().ai_features.model || "sonnet",
    mcpUrl: new URL("/api/assistant/mcp", request.url).toString(),
  });

  // The persisted chat (with the user message + run anchor) so the client
  // can render and subscribe without a second fetch.
  return Response.json(chat, { status: 202 });
}
