"use client";

/**
 * Assistant — full-page chat over the local session history.
 *
 * Conversations are server-persisted (~/.cclens/assistant-chats) and runs
 * are detached from the page: send a message, navigate away, and the agent
 * keeps working — the conversation list shows it running, and reopening
 * replays everything you missed. Live updates arrive over SSE and are
 * folded in with the same reducer the server uses to persist, so restored
 * and live renders can't drift.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { classifyHref } from "@/lib/assistant/links";
import {
  applyRunEvent,
  type Chat,
  type ChatListItem,
  type RunEvent,
  type Segment,
  type ToolSegment,
} from "@/lib/assistant/chat-model";
import { formatRelative } from "@/lib/format";
import {
  CalendarDays,
  Check,
  ClipboardCopy,
  FileText,
  FolderGit2,
  Layers,
  List,
  Loader2,
  MessageSquarePlus,
  Radio,
  RefreshCw,
  Search,
  Send,
  SendHorizonal,
  Sparkles,
  Square,
  X,
} from "lucide-react";

type Suggestion = { label: string; category: "recap" | "find" | "synthesize" | "handoff" };

const FALLBACK_SUGGESTIONS: Suggestion[] = [
  { label: "What did I work on yesterday?", category: "recap" },
  { label: "Find the sessions behind my most recent fix", category: "find" },
  { label: "Which projects did I touch this week, and what happened in each?", category: "synthesize" },
  { label: "Draft a prompt to continue my most recent feature work, with full context", category: "handoff" },
];

const SUGGESTION_ICONS: Record<Suggestion["category"], React.ReactNode> = {
  recap: <CalendarDays size={13} />,
  find: <Search size={13} />,
  synthesize: <Layers size={13} />,
  handoff: <SendHorizonal size={13} />,
};

const SUGGESTION_REFETCH_MS = 25_000;

const TOOL_ICONS: Record<string, React.ReactNode> = {
  search_sessions: <Search size={12} />,
  get_session: <FileText size={12} />,
  list_sessions: <List size={12} />,
  list_projects: <FolderGit2 size={12} />,
};

type IndexState = {
  sessions: number;
  building: boolean;
  progress?: { built: number; total: number };
};

function toolLabel(seg: ToolSegment): string {
  const input = (seg.input ?? {}) as Record<string, unknown>;
  if (typeof input.query === "string") return `“${input.query}”`;
  if (typeof input.session_id === "string") return String(input.session_id).slice(0, 18);
  const keys = Object.entries(input)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return keys.slice(0, 60);
}

function PromptCard({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        border: "1px solid var(--af-accent)",
        borderRadius: 10,
        margin: "10px 0",
        overflow: "hidden",
        background: "var(--af-accent-subtle)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--af-border-subtle)",
        }}
      >
        <Sparkles size={13} color="var(--af-accent)" />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--af-accent)", flex: 1 }}>
          Handoff prompt — paste into your next agent session
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              ?.writeText(text)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => {});
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--af-accent)",
            background: copied ? "var(--af-accent)" : "transparent",
            color: copied ? "#fff" : "var(--af-accent)",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.12s",
          }}
        >
          {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          fontSize: 12,
          lineHeight: 1.55,
          fontFamily: "var(--font-mono)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 380,
          overflowY: "auto",
          color: "var(--af-text)",
          background: "var(--af-surface)",
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: (props) => {
          if (classifyHref(props.href) === "text") return <>{props.children}</>;
          return (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--af-accent)", textDecoration: "underline" }}
            />
          );
        },
        pre: (props) => {
          const child = props.children as React.ReactElement<{ className?: string; children?: unknown }> | undefined;
          const cls = child?.props?.className ?? "";
          if (cls.includes("language-prompt")) {
            return <PromptCard text={String(child?.props?.children ?? "").replace(/\n$/, "")} />;
          }
          return <pre {...props} />;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function ToolChip({ seg }: { seg: ToolSegment }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        margin: "6px 0",
        borderRadius: 7,
        border: "1px solid var(--af-border-subtle)",
        background: "var(--af-surface-hover)",
        fontSize: 11.5,
        fontFamily: "var(--font-mono)",
        color: seg.isError ? "var(--af-danger)" : "var(--af-text-secondary)",
        maxWidth: "100%",
      }}
    >
      <span style={{ color: "var(--af-accent)", flexShrink: 0, display: "inline-flex" }}>
        {TOOL_ICONS[seg.name] ?? <Search size={12} />}
      </span>
      <span style={{ fontWeight: 600, flexShrink: 0 }}>{seg.name}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{toolLabel(seg)}</span>
      {seg.done ? (
        <span style={{ flexShrink: 0, color: seg.isError ? "var(--af-danger)" : "var(--af-text-tertiary)" }}>
          → {seg.isError ? "error" : (seg.brief ?? "done")}
        </span>
      ) : (
        <Loader2 size={11} style={{ flexShrink: 0, animation: "spin 1s linear infinite" }} />
      )}
    </div>
  );
}

function chatUrl(id: string | null): string {
  return id ? `/assistant?chat=${id}` : "/assistant";
}

export function AssistantChat() {
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [index, setIndex] = useState<IndexState | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(FALLBACK_SUGGESTIONS);
  const subscriptionRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const running = chat?.status === "running";

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant/chats");
      const data = (await res.json()) as { chats: ChatListItem[] };
      setChats(data.chats);
    } catch {
      /* list refresh is best-effort */
    }
  }, []);

  const autoScroll = useCallback(() => {
    if (!pinnedToBottom.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, []);

  /** Follow the active run over SSE, folding events in with the shared
   *  reducer. The persisted snapshot we already rendered carries lastSeq,
   *  so ?after= resumes exactly where it left off. */
  const subscribe = useCallback(
    (target: Chat) => {
      subscriptionRef.current?.abort();
      if (target.status !== "running") return;
      const ctrl = new AbortController();
      subscriptionRef.current = ctrl;
      void (async () => {
        try {
          const res = await fetch(`/api/assistant/chats/${target.id}/events?after=${target.lastSeq}`, {
            signal: ctrl.signal,
          });
          if (!res.body) return;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let terminal = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop()!;
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              let event: RunEvent | { type: "sync"; status: string };
              try {
                event = JSON.parse(line.slice(6));
              } catch {
                continue;
              }
              if (event.type === "sync") {
                // No live run — re-fetch the authoritative snapshot.
                const fresh = await fetch(`/api/assistant/chats/${target.id}`);
                if (fresh.ok) setChat((await fresh.json()) as Chat);
                terminal = true;
                continue;
              }
              setChat((prev) => (prev && prev.id === target.id ? applyRunEvent(prev, event as RunEvent) : prev));
              if (event.type === "delta") autoScroll();
              if (event.type === "done" || event.type === "error") terminal = true;
            }
          }
          if (terminal) void refreshList();
        } catch {
          /* aborted on chat switch/unmount, or transient — restore covers it */
        }
      })();
    },
    [autoScroll, refreshList],
  );

  const openChat = useCallback(
    async (id: string | null, pushUrl = true) => {
      subscriptionRef.current?.abort();
      if (pushUrl) window.history.replaceState(null, "", chatUrl(id));
      if (!id) {
        setChat(null);
        return;
      }
      try {
        const res = await fetch(`/api/assistant/chats/${id}`);
        if (!res.ok) {
          setChat(null);
          return;
        }
        const fresh = (await res.json()) as Chat;
        setChat(fresh);
        pinnedToBottom.current = true;
        autoScroll();
        subscribe(fresh);
      } catch {
        setChat(null);
      }
    },
    [autoScroll, subscribe],
  );

  useEffect(() => {
    void refreshList();
    const fromUrl = new URLSearchParams(window.location.search).get("chat");
    if (fromUrl) void openChat(fromUrl, false);
    return () => subscriptionRef.current?.abort();
    // mount-only: URL restore + initial list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While any listed chat is running in the background, poll the list so
  // its badge flips when the run lands.
  useEffect(() => {
    if (!chats.some((c) => c.status === "running" && c.id !== chat?.id)) return;
    const t = setInterval(() => void refreshList(), 5000);
    return () => clearInterval(t);
  }, [chats, chat?.id, refreshList]);

  const refreshIndex = useCallback(async () => {
    setIndex((prev) => ({ sessions: prev?.sessions ?? 0, building: true }));
    try {
      const res = await fetch("/api/assistant/index", { method: "POST" });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as { type: string; built?: number; total?: number; sessions?: number };
            if (data.type === "progress") {
              setIndex({ sessions: data.total ?? 0, building: true, progress: { built: data.built ?? 0, total: data.total ?? 0 } });
            } else if (data.type === "done") {
              setIndex({ sessions: data.sessions ?? 0, building: false });
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      setIndex((prev) => (prev ? { ...prev, building: false } : null));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/assistant/index")
      .then((r) => r.json())
      .then((stats: { sessions: number; building: boolean }) => {
        if (cancelled) return;
        setIndex({ sessions: stats.sessions, building: stats.building });
        if (stats.sessions === 0 && !stats.building) void refreshIndex();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshIndex]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      fetch("/api/assistant/suggestions")
        .then((r) => r.json())
        .then((data: { suggestions?: Suggestion[]; refreshing?: boolean }) => {
          if (cancelled) return;
          if (Array.isArray(data.suggestions) && data.suggestions.length > 0) setSuggestions(data.suggestions);
          if (data.refreshing && attempt < 2) timer = setTimeout(() => load(attempt + 1), SUGGESTION_REFETCH_MS);
        })
        .catch(() => {});
    };
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || sending || running) return;
      setSending(true);
      setInput("");
      pinnedToBottom.current = true;
      try {
        let id = chat?.id;
        if (!id) {
          const created = await fetch("/api/assistant/chats", { method: "POST" });
          id = ((await created.json()) as { id: string }).id;
          window.history.replaceState(null, "", chatUrl(id));
        }
        const res = await fetch(`/api/assistant/chats/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const err = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`;
          setChat((prev) =>
            prev
              ? {
                  ...prev,
                  messages: [
                    ...prev.messages,
                    { role: "user", text },
                    { role: "assistant", segments: [{ kind: "text", text: `**Error:** ${err}` }] },
                  ],
                }
              : prev,
          );
          return;
        }
        const fresh = (await res.json()) as Chat;
        setChat(fresh);
        autoScroll();
        subscribe(fresh);
        void refreshList();
      } finally {
        setSending(false);
      }
    },
    [chat?.id, sending, running, autoScroll, subscribe, refreshList],
  );

  const stop = useCallback(() => {
    if (!chat) return;
    void fetch(`/api/assistant/chats/${chat.id}/stop`, { method: "POST" });
  }, [chat]);

  const removeChat = useCallback(
    async (id: string) => {
      await fetch(`/api/assistant/chats/${id}`, { method: "DELETE" });
      if (chat?.id === id) void openChat(null);
      void refreshList();
    },
    [chat?.id, openChat, refreshList],
  );

  const indexChip = index && (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 100,
        border: "1px solid var(--af-border-subtle)",
        background: "var(--af-surface)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--af-text-tertiary)",
        whiteSpace: "nowrap",
      }}
    >
      {index.building ? (
        <>
          <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
          {index.progress ? `indexing ${index.progress.built}/${index.progress.total}` : "indexing…"}
        </>
      ) : (
        <>{index.sessions.toLocaleString()} sessions indexed</>
      )}
    </span>
  );

  const emptyState = !chat || chat.messages.length === 0;

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Conversation list */}
      <div
        style={{
          width: 230,
          flexShrink: 0,
          borderRight: "1px solid var(--af-border-subtle)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--af-surface)",
        }}
      >
        <div style={{ padding: "12px 12px 8px" }}>
          <button
            type="button"
            onClick={() => void openChat(null)}
            style={{
              width: "100%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--af-border-subtle)",
              background: "var(--af-surface-hover)",
              color: "var(--af-text)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <MessageSquarePlus size={14} />
            New chat
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px" }}>
          {chats.length === 0 && (
            <div style={{ padding: "14px 8px", fontSize: 11.5, color: "var(--af-text-tertiary)", lineHeight: 1.5 }}>
              No conversations yet. Runs keep going even if you leave the page.
            </div>
          )}
          {chats.map((c) => {
            const active = c.id === chat?.id;
            return (
              <div
                key={c.id}
                onClick={() => void openChat(c.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  marginBottom: 2,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: active ? "var(--af-accent-subtle)" : "transparent",
                  border: `1px solid ${active ? "var(--af-accent)" : "transparent"}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: active ? 600 : 500,
                      color: "var(--af-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    {c.status === "running" && (
                      <Loader2 size={10} color="var(--af-accent)" style={{ animation: "spin 1s linear infinite" }} />
                    )}
                    {c.status === "error" && (
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--af-danger)" }} />
                    )}
                    <span style={{ fontSize: 10.5, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                      {c.status === "running" ? "running" : formatRelative(c.updated_at)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeChat(c.id);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--af-text-tertiary)",
                    cursor: "pointer",
                    padding: 2,
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 28px",
            borderBottom: "1px solid var(--af-border-subtle)",
            background: "color-mix(in srgb, var(--background) 82%, transparent)",
            backdropFilter: "blur(10px)",
            flexShrink: 0,
          }}
        >
          <Sparkles size={16} color="var(--af-accent)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--af-text)" }}>Assistant</div>
            <div style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
              Search, synthesize, and hand off your local session history
            </div>
          </div>
          {indexChip}
          <a
            href="/runs"
            title="LLM runs — inspect every local model call"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--af-border-subtle)",
              background: "transparent",
              color: "var(--af-text-tertiary)",
              fontSize: 11.5,
              textDecoration: "none",
            }}
          >
            <Radio size={13} />
            Runs
          </a>
          <button
            type="button"
            title="Refresh search index"
            onClick={() => void refreshIndex()}
            disabled={index?.building ?? false}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: 6,
              borderRadius: 6,
              border: "1px solid var(--af-border-subtle)",
              background: "transparent",
              color: "var(--af-text-tertiary)",
              cursor: index?.building ? "wait" : "pointer",
            }}
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (!el) return;
            pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 28px" }}
        >
          <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
            {emptyState && (
              <div style={{ paddingTop: 48, textAlign: "center" }}>
                <Sparkles size={26} color="var(--af-accent)" style={{ marginBottom: 12 }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--af-text)", marginBottom: 6 }}>
                  Ask anything about your past sessions
                </div>
                <div style={{ fontSize: 12.5, color: "var(--af-text-secondary)", marginBottom: 26, lineHeight: 1.5 }}>
                  Every conversation is searched locally — nothing leaves this machine.
                  <br />
                  Find past work, get it synthesized, or turn it into a prompt for your next agent run.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 520, margin: "0 auto" }}>
                  {suggestions.map((s) => (
                    <button
                      key={s.category}
                      type="button"
                      onClick={() => void send(s.label)}
                      disabled={sending}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 14px",
                        border: "1px solid var(--af-border-subtle)",
                        borderRadius: 8,
                        background: "var(--af-surface)",
                        color: "var(--af-text)",
                        fontSize: 12.5,
                        cursor: sending ? "wait" : "pointer",
                        textAlign: "left",
                        transition: "all 0.12s",
                        fontFamily: "inherit",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--af-accent)";
                        e.currentTarget.style.background = "var(--af-accent-subtle)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--af-border-subtle)";
                        e.currentTarget.style.background = "var(--af-surface)";
                      }}
                    >
                      <span style={{ color: "var(--af-accent)", flexShrink: 0, display: "inline-flex" }}>
                        {SUGGESTION_ICONS[s.category]}
                      </span>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chat?.messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div
                    style={{
                      maxWidth: "82%",
                      padding: "9px 14px",
                      borderRadius: 12,
                      background: "var(--af-surface-hover)",
                      border: "1px solid var(--af-border-subtle)",
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "var(--af-text)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div key={i} style={{ minWidth: 0 }}>
                  {msg.segments.length === 0 && running && i === chat.messages.length - 1 && (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--af-text-tertiary)", fontSize: 12 }}
                    >
                      <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                      Thinking…
                    </div>
                  )}
                  {msg.segments.map((seg: Segment, j: number) =>
                    seg.kind === "tool" ? (
                      <div key={j}>
                        <ToolChip seg={seg} />
                      </div>
                    ) : (
                      <div key={j} className="sl-prose" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                        <Markdown text={seg.text} />
                      </div>
                    ),
                  )}
                </div>
              ),
            )}
          </div>
        </div>

        {/* Composer */}
        <div
          style={{
            borderTop: "1px solid var(--af-border-subtle)",
            padding: "14px 28px 18px",
            background: "var(--background)",
            flexShrink: 0,
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            style={{ maxWidth: 780, margin: "0 auto", display: "flex", gap: 8, alignItems: "flex-end" }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={
                running
                  ? "The agent is working — you can leave this page and come back…"
                  : "Search your session history, ask for a synthesis, or request a handoff prompt…"
              }
              rows={Math.min(4, Math.max(1, input.split("\n").length))}
              style={{
                flex: 1,
                resize: "none",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--af-border-subtle)",
                background: "var(--af-surface)",
                color: "var(--af-text)",
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: "inherit",
                outline: "none",
              }}
            />
            {running ? (
              <button
                type="button"
                onClick={stop}
                title="Stop this run"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  border: "1px solid var(--af-danger)",
                  background: "transparent",
                  color: "var(--af-danger)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || sending}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  border: "none",
                  background: input.trim() && !sending ? "var(--af-accent)" : "var(--af-border-subtle)",
                  color: input.trim() && !sending ? "#fff" : "var(--af-text-tertiary)",
                  cursor: input.trim() && !sending ? "pointer" : "not-allowed",
                  flexShrink: 0,
                }}
              >
                <Send size={15} />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
