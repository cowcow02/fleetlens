import { createChat, listChats, readChat, writeChat } from "@/lib/agent/chat-store";
import { getRun, reconcileChat } from "@/lib/agent/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const items = listChats().map((item) => {
    // Repair zombies lazily so the list never shows a spinner forever.
    if (item.status === "running" && !getRun(item.id)) {
      const chat = readChat(item.id);
      if (chat) {
        const repaired = reconcileChat(chat);
        return { ...item, status: repaired.status, updated_at: repaired.updated_at };
      }
    }
    return item;
  });
  return Response.json({ chats: items });
}

export function POST() {
  const chat = createChat();
  writeChat(chat);
  return Response.json({ id: chat.id }, { status: 201 });
}
