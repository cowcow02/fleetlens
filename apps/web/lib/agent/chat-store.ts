import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";
import type { Chat, ChatListItem } from "./chat-model";

export * from "./chat-model";

/* ── persistence: one JSON file per conversation ───────────────────── */

function chatsDir(): string {
  return cclensPath("agent-chats");
}

function chatPath(id: string): string {
  return join(chatsDir(), `${id}.json`);
}

export function writeChat(chat: Chat): void {
  mkdirSync(chatsDir(), { recursive: true });
  const final = chatPath(chat.id);
  const tmp = `${final}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(chat), "utf8");
  renameSync(tmp, final);
}

export function readChat(id: string): Chat | null {
  // Ids come from URLs — resolve strictly inside the chats dir.
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  try {
    const chat = JSON.parse(readFileSync(chatPath(id), "utf8")) as Chat;
    return chat.version === 1 ? chat : null;
  } catch {
    return null;
  }
}

export function listChats(): ChatListItem[] {
  if (!existsSync(chatsDir())) return [];
  const out: ChatListItem[] = [];
  for (const f of readdirSync(chatsDir())) {
    if (!f.endsWith(".json")) continue;
    const chat = readChat(f.slice(0, -".json".length));
    if (!chat) continue;
    out.push({
      id: chat.id,
      title: chat.title,
      updated_at: chat.updated_at,
      status: chat.status,
      messageCount: chat.messages.length,
    });
  }
  out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return out;
}

export function deleteChat(id: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  rmSync(chatPath(id), { force: true });
}
