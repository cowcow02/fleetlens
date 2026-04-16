import React from "react";
import { shortenToolName } from "./turn-steps";

export type ToolUseInput = Record<string, unknown> | unknown;

function splitPath(p: string): { dir: string; file: string } {
  const parts = p.split("/");
  const file = parts[parts.length - 1] ?? p;
  const dirParts = parts.slice(0, -1).filter(Boolean);
  const dir =
    dirParts.length > 3
      ? "…/" + dirParts.slice(-3).join("/")
      : dirParts.join("/");
  return { dir: dir || "", file };
}

export function PathLabel({ path }: { path: string }) {
  const { dir, file } = splitPath(path);
  return (
    <code
      style={{
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--af-text)",
      }}
    >
      {dir && <span style={{ color: "var(--af-text-tertiary)" }}>{dir}/</span>}
      <b style={{ fontWeight: 600 }}>{file}</b>
    </code>
  );
}

export function ToolCardShell({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 8,
        background: "var(--background)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: children ? "1px solid var(--af-border-subtle)" : "none",
          fontSize: 12,
          color: "var(--af-text-secondary)",
        }}
      >
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

export function CodeBlock({
  text,
  maxHeight = 280,
}: {
  text: string;
  maxHeight?: number;
}) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "10px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        lineHeight: 1.55,
        color: "var(--af-text)",
        whiteSpace: "pre",
        overflow: "auto",
        maxHeight,
      }}
    >
      {text}
    </pre>
  );
}

export function DiffView({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  return (
    <pre
      style={{
        margin: 0,
        padding: "10px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        lineHeight: 1.55,
        whiteSpace: "pre",
        overflow: "auto",
        maxHeight: 320,
      }}
    >
      {oldLines.map((line, i) => (
        <div
          key={`o${i}`}
          style={{
            background: "rgba(220, 38, 38, 0.08)",
            color: "#991B1B",
            padding: "0 4px",
            borderLeft: "3px solid #DC2626",
          }}
        >
          <span style={{ opacity: 0.6, userSelect: "none" }}>− </span>
          {line || "\u00A0"}
        </div>
      ))}
      {newLines.map((line, i) => (
        <div
          key={`n${i}`}
          style={{
            background: "rgba(5, 150, 105, 0.08)",
            color: "#065F46",
            padding: "0 4px",
            borderLeft: "3px solid #059669",
          }}
        >
          <span style={{ opacity: 0.6, userSelect: "none" }}>+ </span>
          {line || "\u00A0"}
        </div>
      ))}
    </pre>
  );
}

export function ToolUseCard({
  name,
  input,
}: {
  name: string;
  input: ToolUseInput;
}) {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof i[k] === "string" ? (i[k] as string) : undefined;
  const num = (k: string): number | undefined =>
    typeof i[k] === "number" ? (i[k] as number) : undefined;

  if (name === "Write") {
    const filePath = str("file_path") ?? "";
    const content = str("content") ?? "";
    return (
      <ToolCardShell
        icon="📝"
        label={
          <>
            <b>Write</b> <PathLabel path={filePath} />
          </>
        }
      >
        <CodeBlock text={content} />
      </ToolCardShell>
    );
  }

  if (name === "Edit") {
    const filePath = str("file_path") ?? "";
    const oldStr = str("old_string") ?? "";
    const newStr = str("new_string") ?? "";
    const replaceAll = i.replace_all === true;
    return (
      <ToolCardShell
        icon="✏️"
        label={
          <>
            <b>Edit</b> <PathLabel path={filePath} />
            {replaceAll && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--af-warning)",
                  background: "var(--af-warning-subtle)",
                  padding: "1px 6px",
                  borderRadius: 10,
                }}
              >
                replace all
              </span>
            )}
          </>
        }
      >
        <DiffView oldText={oldStr} newText={newStr} />
      </ToolCardShell>
    );
  }

  if (name === "Read") {
    const filePath = str("file_path") ?? "";
    const offset = num("offset");
    const limit = num("limit");
    const range =
      offset !== undefined || limit !== undefined
        ? ` · lines ${offset ?? 1}${limit !== undefined ? `–${(offset ?? 0) + limit}` : "…"}`
        : "";
    return (
      <ToolCardShell
        icon="📖"
        label={
          <>
            <b>Read</b> <PathLabel path={filePath} />
            <span style={{ color: "var(--af-text-tertiary)" }}>{range}</span>
          </>
        }
      />
    );
  }

  if (name === "Bash") {
    const command = str("command") ?? "";
    const description = str("description");
    const runInBg = i.run_in_background === true;
    return (
      <ToolCardShell
        icon="⚡"
        label={
          <>
            <b>Bash</b>
            {description && (
              <span style={{ color: "var(--af-text)", fontStyle: "italic" }}>
                {description}
              </span>
            )}
            {runInBg && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--af-info)",
                  background: "var(--af-info-subtle)",
                  padding: "1px 6px",
                  borderRadius: 10,
                }}
              >
                background
              </span>
            )}
          </>
        }
      >
        <CodeBlock text={command} maxHeight={220} />
      </ToolCardShell>
    );
  }

  if (name === "Grep") {
    const pattern = str("pattern") ?? "";
    const path = str("path");
    const glob = str("glob");
    const type = str("type");
    const outputMode = str("output_mode");
    return (
      <ToolCardShell
        icon="🔍"
        label={
          <>
            <b>Grep</b>{" "}
            <code
              style={{
                background: "var(--af-border-subtle)",
                padding: "1px 6px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              {pattern}
            </code>
            {path && (
              <>
                {" in "}
                <PathLabel path={path} />
              </>
            )}
            {(glob || type || outputMode) && (
              <span
                style={{
                  color: "var(--af-text-tertiary)",
                  fontSize: 11,
                  marginLeft: 6,
                }}
              >
                {[
                  glob && `glob=${glob}`,
                  type && `type=${type}`,
                  outputMode && `mode=${outputMode}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </>
        }
      />
    );
  }

  if (name === "Glob") {
    const pattern = str("pattern") ?? "";
    const path = str("path");
    return (
      <ToolCardShell
        icon="📁"
        label={
          <>
            <b>Glob</b>{" "}
            <code
              style={{
                background: "var(--af-border-subtle)",
                padding: "1px 6px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              {pattern}
            </code>
            {path && (
              <>
                {" in "}
                <PathLabel path={path} />
              </>
            )}
          </>
        }
      />
    );
  }

  if (name === "Skill") {
    const skill = str("skill") ?? "";
    const args = str("args");
    return (
      <ToolCardShell
        icon="🧩"
        label={
          <>
            <b>/{skill}</b>
            {args && (
              <span style={{ color: "var(--af-text-secondary)" }}>{args}</span>
            )}
          </>
        }
      />
    );
  }

  if (name === "ToolSearch") {
    const query = str("query") ?? "";
    const max = num("max_results");
    return (
      <ToolCardShell
        icon="🔎"
        label={
          <>
            <b>ToolSearch</b>{" "}
            <code
              style={{
                background: "var(--af-border-subtle)",
                padding: "1px 6px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              {query}
            </code>
            {max !== undefined && (
              <span
                style={{ color: "var(--af-text-tertiary)", fontSize: 11 }}
              >
                max={max}
              </span>
            )}
          </>
        }
      />
    );
  }

  if (name === "TodoWrite") {
    const todos = Array.isArray(i.todos)
      ? (i.todos as Array<Record<string, unknown>>)
      : [];
    return (
      <ToolCardShell icon="✅" label={<b>TodoWrite · {todos.length} items</b>}>
        <div style={{ padding: "10px 12px", fontSize: 12 }}>
          {todos.map((t, ti) => {
            const status = String(t.status ?? "pending");
            const content =
              typeof t.content === "string"
                ? t.content
                : typeof t.activeForm === "string"
                  ? t.activeForm
                  : "";
            const icon =
              status === "completed"
                ? "✔"
                : status === "in_progress"
                  ? "◐"
                  : "○";
            return (
              <div
                key={ti}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "2px 0",
                  opacity: status === "completed" ? 0.6 : 1,
                  textDecoration:
                    status === "completed" ? "line-through" : "none",
                }}
              >
                <span style={{ color: "var(--af-text-tertiary)" }}>{icon}</span>
                <span>{content}</span>
              </div>
            );
          })}
        </div>
      </ToolCardShell>
    );
  }

  if (name.startsWith("mcp__")) {
    const short = shortenToolName(name);
    return (
      <ToolCardShell icon="🔌" label={<b>{short}</b>}>
        <CodeBlock text={JSON.stringify(input, null, 2)} maxHeight={200} />
      </ToolCardShell>
    );
  }

  return (
    <ToolCardShell icon="🔧" label={<b>{name}</b>}>
      <CodeBlock text={JSON.stringify(input, null, 2)} maxHeight={220} />
    </ToolCardShell>
  );
}
