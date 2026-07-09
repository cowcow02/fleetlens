"use client";

import { useEffect, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import { formatRelative } from "@/lib/format";

export type ProjectLocalFolder = {
  path: string;
  canonicalProject: string;
  reasons: string[];
  worktreeNames: string[];
  agents: string[];
  projectDirs: string[];
  sessionCount: number;
  lastTimestamp?: string;
  canOpen: boolean;
};

type OpenState =
  | { kind: "idle" }
  | { kind: "opening"; path: string }
  | { kind: "opened"; path: string }
  | { kind: "error"; path: string; message: string };

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? `${parts.at(-2)}/${parts.at(-1)}` : path;
}

export function ProjectLocalFoldersButton({
  projectKey,
  folders,
}: {
  projectKey: string;
  folders: ProjectLocalFolder[];
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OpenState>({ kind: "idle" });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function openFolder(path: string) {
    setState({ kind: "opening", path });
    const res = await fetch("/api/projects/open-folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectKey, path }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setState({
        kind: "error",
        path,
        message: body?.error ?? "Could not open this folder.",
      });
      return;
    }
    setState({ kind: "opened", path });
  }

  return (
    <>
      <button
        type="button"
        className="af-btn"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          whiteSpace: "nowrap",
        }}
      >
        <FolderOpen size={14} />
        Local folders
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--af-text-tertiary)",
          }}
        >
          {folders.length}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="local-folders-title"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 220,
            background: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--af-surface-elevated)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 10,
              width: "min(860px, 100%)",
              maxHeight: "86vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 18px 54px rgba(0, 0, 0, 0.35)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: "16px 20px",
                borderBottom: "1px solid var(--af-border-subtle)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <h2
                  id="local-folders-title"
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Aggregated local folders
                </h2>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    color: "var(--af-text-tertiary)",
                  }}
                >
                  Folders from sessions that currently roll up into this project.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--af-text-tertiary)",
                  cursor: "pointer",
                  padding: 4,
                  lineHeight: 0,
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ overflow: "auto", padding: 14 }}>
              {folders.length === 0 ? (
                <div className="af-empty">No local folders were found for this project.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {folders.map((folder) => {
                    const isBusy = state.kind === "opening" && state.path === folder.path;
                    const isOpened = state.kind === "opened" && state.path === folder.path;
                    const isError = state.kind === "error" && state.path === folder.path;
                    return (
                      <div
                        key={folder.path}
                        style={{
                          border: "1px solid var(--af-border-subtle)",
                          borderRadius: 8,
                          background: "var(--af-surface)",
                          padding: 12,
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: 12,
                          alignItems: "start",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 6,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: "var(--af-text)",
                              }}
                            >
                              {shortPath(folder.path)}
                            </span>
                            {folder.worktreeNames.map((name) => (
                              <span
                                key={name}
                                style={{
                                  border: "1px solid var(--af-border-subtle)",
                                  borderRadius: 999,
                                  padding: "1px 7px",
                                  fontSize: 10,
                                  color: "var(--af-text-secondary)",
                                }}
                              >
                                worktree: {name}
                              </span>
                            ))}
                          </div>
                          <div
                            title={folder.path}
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 11,
                              color: "var(--af-text-secondary)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              marginBottom: 8,
                            }}
                          >
                            {folder.path}
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "92px minmax(0, 1fr)",
                              rowGap: 5,
                              columnGap: 10,
                              fontSize: 11,
                              color: "var(--af-text-tertiary)",
                            }}
                          >
                            <span>Grouped via</span>
                            <span style={{ color: "var(--af-text-secondary)" }}>
                              {folder.reasons.join(", ")}
                            </span>
                            <span>Into</span>
                            <span
                              title={folder.canonicalProject}
                              style={{
                                fontFamily: "var(--font-mono)",
                                color: "var(--af-text-secondary)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {folder.canonicalProject}
                            </span>
                            <span>Sessions</span>
                            <span style={{ color: "var(--af-text-secondary)" }}>
                              {folder.sessionCount} session{folder.sessionCount === 1 ? "" : "s"}
                              {" | "}
                              {folder.agents.join(", ")}
                              {folder.lastTimestamp ? ` | ${formatRelative(folder.lastTimestamp)}` : ""}
                            </span>
                            <span>Transcript dir</span>
                            <span
                              title={folder.projectDirs.join(", ")}
                              style={{
                                fontFamily: "var(--font-mono)",
                                color: "var(--af-text-secondary)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {folder.projectDirs.join(", ")}
                            </span>
                          </div>
                          {isError && (
                            <div
                              style={{
                                marginTop: 8,
                                fontSize: 11,
                                color: "var(--af-danger)",
                              }}
                            >
                              {state.message}
                            </div>
                          )}
                          {isOpened && (
                            <div
                              style={{
                                marginTop: 8,
                                fontSize: 11,
                                color: "var(--af-accent)",
                              }}
                            >
                              Asked Finder to open this folder.
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="af-btn"
                          disabled={!folder.canOpen || isBusy}
                          onClick={() => openFolder(folder.path)}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {isBusy ? "Opening..." : "Open in Finder"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
