"use client";

/**
 * Assistant — full-page chat over the local session history.
 *
 * Streams POST /api/assistant/chat (SSE): assistant text deltas interleaved
 * with tool-activity events, rendered as an ordered list of segments so the
 * conversation reads exactly as it happened. ```prompt fenced blocks are
 * rendered as a copyable handoff-prompt card.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CalendarDays,
  Check,
  ClipboardCopy,
  FileText,
  FolderGit2,
  Layers,
  List,
  Loader2,
  RefreshCw,
  Search,
  Send,
  SendHorizonal,
  Sparkles,
  Square,
} from "lucide-react";

type TextSegment = { kind: "text"; text: string };
type ToolSegment = {
  kind: "tool";
  id: string;
  name: string;
  input: unknown;
  brief?: string;
  isError?: boolean;
  done: boolean;
};
type Segment = TextSegment | ToolSegment;

type ChatMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; segments: Segment[]; done: boolean };

type IndexState = {
  sessions: number;
  building: boolean;
  progress?: { built: number; total: number };
};

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

function assistantText(segments: Segment[]): string {
  return segments
    .filter((s): s is TextSegment => s.kind === "text")
    .map((s) => s.text)
    .join("");
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
            navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
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
        a: (props) => (
          <a
            {...props}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--af-accent)", textDecoration: "underline" }}
          />
        ),
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

export function AssistantChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [index, setIndex] = useState<IndexState | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(FALLBACK_SUGGESTIONS);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  // Personalized chips: take whatever the server has now; if a background
  // regeneration is running, poll once more so fresh chips land mid-visit.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      fetch("/api/assistant/suggestions")
        .then((r) => r.json())
        .then((data: { suggestions?: Suggestion[]; refreshing?: boolean }) => {
          if (cancelled) return;
          if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
            setSuggestions(data.suggestions);
          }
          if (data.refreshing && attempt < 2) {
            timer = setTimeout(() => load(attempt + 1), SUGGESTION_REFETCH_MS);
          }
        })
        .catch(() => {});
    };
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

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
            const data = JSON.parse(line.slice(6)) as {
              type: string;
              built?: number;
              total?: number;
              sessions?: number;
            };
            if (data.type === "progress") {
              setIndex({
                sessions: data.total ?? 0,
                building: true,
                progress: { built: data.built ?? 0, total: data.total ?? 0 },
              });
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
        // Cold start: kick the first build so the agent's first search is fast.
        if (stats.sessions === 0 && !stats.building) void refreshIndex();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshIndex]);

  const autoScroll = useCallback(() => {
    if (!pinnedToBottom.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, []);

  const send = useCallback(
    async (question: string) => {
      if (streaming || !question.trim()) return;
      const history = [...messages, { role: "user" as const, text: question }];
      setMessages([...history, { role: "assistant", segments: [], done: false }]);
      setInput("");
      setStreaming(true);
      pinnedToBottom.current = true;
      autoScroll();

      const patchAssistant = (fn: (segments: Segment[]) => Segment[]) => {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (!last || last.role !== "assistant") return prev;
          copy[copy.length - 1] = { ...last, segments: fn(last.segments) };
          return copy;
        });
      };

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) =>
              m.role === "user" ? { role: "user", text: m.text } : { role: "assistant", text: assistantText(m.segments) },
            ),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.text();
          patchAssistant((segs) => [...segs, { kind: "text", text: `**Error:** ${err}` }]);
          return;
        }
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
            let data: {
              type: string;
              text?: string;
              id?: string;
              name?: string;
              input?: unknown;
              brief?: string;
              isError?: boolean;
              message?: string;
            };
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (data.type === "delta" && data.text) {
              patchAssistant((segs) => {
                const last = segs[segs.length - 1];
                if (last?.kind === "text") {
                  return [...segs.slice(0, -1), { kind: "text", text: last.text + data.text! }];
                }
                return [...segs, { kind: "text", text: data.text! }];
              });
              autoScroll();
            } else if (data.type === "tool") {
              patchAssistant((segs) => [
                ...segs,
                { kind: "tool", id: data.id ?? "", name: data.name ?? "tool", input: data.input, done: false },
              ]);
              autoScroll();
            } else if (data.type === "tool_result") {
              patchAssistant((segs) =>
                segs.map((s) =>
                  s.kind === "tool" && s.id === data.id
                    ? { ...s, done: true, brief: data.brief, isError: data.isError }
                    : s,
                ),
              );
            } else if (data.type === "error") {
              patchAssistant((segs) => [...segs, { kind: "text", text: `\n\n**Error:** ${data.message}` }]);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patchAssistant((segs) => [...segs, { kind: "text", text: `\n\n**Error:** ${(err as Error).message}` }]);
        }
      } finally {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = {
              ...last,
              done: true,
              segments: last.segments.map((s) => (s.kind === "tool" && !s.done ? { ...s, done: true } : s)),
            };
          }
          return copy;
        });
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, autoScroll],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

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
          {messages.length === 0 && (
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
                    disabled={streaming}
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
                      cursor: streaming ? "wait" : "pointer",
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

          {messages.map((msg, i) =>
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
                {msg.segments.length === 0 && !msg.done && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: "var(--af-text-tertiary)",
                      fontSize: 12,
                    }}
                  >
                    <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                    Thinking…
                  </div>
                )}
                {msg.segments.map((seg, j) =>
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
            placeholder="Search your session history, ask for a synthesis, or request a handoff prompt…"
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
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              title="Stop"
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
              disabled={!input.trim()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                borderRadius: 10,
                border: "none",
                background: input.trim() ? "var(--af-accent)" : "var(--af-border-subtle)",
                color: input.trim() ? "#fff" : "var(--af-text-tertiary)",
                cursor: input.trim() ? "pointer" : "not-allowed",
                flexShrink: 0,
              }}
            >
              <Send size={15} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
