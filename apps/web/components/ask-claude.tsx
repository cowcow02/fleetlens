"use client";

/**
 * "Ask Claude" drawer for session analysis.
 *
 * Renders as a right-side panel with:
 * - Quick-action buttons (Identify errors, Analyze performance, etc.)
 * - Free-form textarea for custom questions
 * - Streaming markdown response
 *
 * Calls POST /api/ask which spawns `claude -p` under the hood, using
 * the user's local keychain auth. No API key management required.
 */

import React, { useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  BarChart3,
  Lightbulb,
  MessageCircle,
  Route,
  Send,
  X,
  Loader2,
} from "lucide-react";

type Message = {
  role: "user" | "assistant";
  text: string;
};

const QUICK_ACTIONS = [
  {
    label: "Identify errors",
    icon: <AlertTriangle size={13} />,
    prompt:
      "Find all errors, exceptions, rate limits, or failed operations in this session. For each, explain what happened and what triggered it.",
  },
  {
    label: "Analyze performance",
    icon: <BarChart3 size={13} />,
    prompt:
      "Analyze the performance of this session — tool execution frequency, token efficiency, cache hit ratio, and any bottlenecks. Include specific numbers.",
  },
  {
    label: "Trace conversation flow",
    icon: <Route size={13} />,
    prompt:
      "Trace the conversation logic: what was the user trying to accomplish, what decisions did the agent make at each key point, and how did the approach evolve?",
  },
  {
    label: "Suggest improvements",
    icon: <Lightbulb size={13} />,
    prompt:
      "Based on this session, suggest concrete improvements to the prompting strategy, tool usage patterns, or workflow. Be specific about what to change and why.",
  },
];

export function AskClaudeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        border: "1px solid var(--af-accent)",
        borderRadius: 7,
        background: "var(--af-accent-subtle)",
        color: "var(--af-accent)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--af-accent)";
        e.currentTarget.style.color = "#fff";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--af-accent-subtle)";
        e.currentTarget.style.color = "var(--af-accent)";
      }}
    >
      <MessageCircle size={13} />
      Ask Claude
    </button>
  );
}

export function AskClaudeDrawer({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ask = useCallback(
    async (question: string) => {
      if (streaming) return;
      const userMsg: Message = { role: "user", text: question };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setStreaming(true);

      // Start with an empty assistant message that we'll append to.
      let assistantText = "";
      setMessages((prev) => [...prev, { role: "assistant", text: "" }]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, question }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.text();
          assistantText = `Error: ${err}`;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", text: assistantText };
            return copy;
          });
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines.
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;
            try {
              const data = JSON.parse(json) as {
                type: string;
                text?: string;
                message?: string;
              };
              if (data.type === "delta" && data.text) {
                assistantText += data.text;
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[copy.length - 1] = {
                    role: "assistant",
                    text: assistantText,
                  };
                  return copy;
                });
                // Auto-scroll to bottom.
                requestAnimationFrame(() => {
                  scrollRef.current?.scrollTo({
                    top: scrollRef.current.scrollHeight,
                  });
                });
              } else if (data.type === "error") {
                assistantText += `\n\n**Error:** ${data.message}`;
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[copy.length - 1] = {
                    role: "assistant",
                    text: assistantText,
                  };
                  return copy;
                });
              }
            } catch {
              // skip malformed
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          assistantText += `\n\n**Error:** ${(err as Error).message}`;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", text: assistantText };
            return copy;
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId, streaming],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (q) ask(q);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--af-surface)",
          flexShrink: 0,
        }}
      >
        <MessageCircle size={16} color="var(--af-accent)" />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--af-text)",
            flex: 1,
          }}
        >
          Ask Claude
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--af-text-tertiary)",
            padding: 4,
            borderRadius: 4,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {messages.length === 0 && (
          <div>
            <div
              style={{
                fontSize: 13,
                color: "var(--af-text-secondary)",
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              Ask Claude to analyze this session. Pick a quick action or type
              your own question.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => ask(action.prompt)}
                  disabled={streaming}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    border: "1px solid var(--af-border-subtle)",
                    borderRadius: 8,
                    background: "var(--af-surface-hover)",
                    color: "var(--af-text)",
                    fontSize: 12.5,
                    fontWeight: 500,
                    cursor: streaming ? "wait" : "pointer",
                    textAlign: "left",
                    transition: "all 0.12s",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    if (!streaming) {
                      e.currentTarget.style.borderColor = "var(--af-accent)";
                      e.currentTarget.style.background = "var(--af-accent-subtle)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--af-border-subtle)";
                    e.currentTarget.style.background = "var(--af-surface-hover)";
                  }}
                >
                  <span style={{ color: "var(--af-accent)", flexShrink: 0 }}>
                    {action.icon}
                  </span>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "user" ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--af-text-secondary)",
                  padding: "8px 12px",
                  background: "var(--af-border-subtle)",
                  borderRadius: 8,
                  lineHeight: 1.45,
                }}
              >
                {msg.text.length > 200 ? msg.text.slice(0, 80) + "…" : msg.text}
              </div>
            ) : (
              <div className="sl-prose" style={{ fontSize: 13, lineHeight: 1.55 }}>
                {msg.text ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: (props) => (
                        <a
                          {...props}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "var(--af-accent)",
                            textDecoration: "underline",
                          }}
                        />
                      ),
                    }}
                  >
                    {msg.text}
                  </ReactMarkdown>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: "var(--af-text-tertiary)",
                      fontSize: 12,
                      padding: "8px 0",
                    }}
                  >
                    <Loader2
                      size={14}
                      style={{ animation: "spin 1s linear infinite" }}
                    />
                    Thinking…
                    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--af-border-subtle)",
          display: "flex",
          gap: 8,
          flexShrink: 0,
          background: "var(--af-surface)",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this session…"
          disabled={streaming}
          style={{
            flex: 1,
            fontSize: 13,
          }}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: 8,
            border: "none",
            background:
              streaming || !input.trim() ? "var(--af-border-subtle)" : "var(--af-accent)",
            color: streaming || !input.trim() ? "var(--af-text-tertiary)" : "#fff",
            cursor: streaming || !input.trim() ? "not-allowed" : "pointer",
            transition: "all 0.12s",
            flexShrink: 0,
          }}
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
