"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  ListTree,
  FolderOpen,
  GitBranch,
  Pin,
  PinOff,
  Search,
  Activity,
  Gauge,
} from "lucide-react";
import { formatRelative, prettyProjectName } from "@/lib/format";
import { ThemeToggle } from "@/components/theme-toggle";
import { UsageSidebar } from "@/components/usage-sidebar";
import type { UsageSnapshot } from "@/lib/usage-data";

export type ProjectRef = {
  projectDir: string;
  projectName: string;
  sessionCount: number;
  lastActiveMs?: number;
  /** Number of `.worktrees/<name>` subdirs rolled up into this project. */
  worktreeCount?: number;
};

const PINS_KEY = "claude-lens:pinned-projects:v1";

function loadPins(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PINS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function savePins(pins: Set<string>) {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(Array.from(pins)));
  } catch {
    // ignore
  }
}

export function Sidebar({
  projects,
  totalSessions,
  currentUsage,
}: {
  projects: ProjectRef[];
  totalSessions: number;
  currentUsage: UsageSnapshot | null;
}) {
  const pathname = usePathname();
  const [pins, setPins] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setPins(loadPins());
    setHydrated(true);
  }, []);

  const togglePin = (dir: string) => {
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      savePins(next);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter((p) => p.projectName.toLowerCase().includes(q));
  }, [projects, query]);

  const pinned = filtered.filter((p) => pins.has(p.projectDir));
  const unpinned = filtered.filter((p) => !pins.has(p.projectDir));

  return (
    <aside
      style={{
        width: 260,
        flexShrink: 0,
        borderRight: "1px solid var(--af-border-subtle)",
        background: "var(--af-surface)",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "18px 20px 12px",
          borderBottom: "1px solid var(--af-border-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "var(--af-accent-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--af-accent)",
            }}
          >
            <Activity size={16} strokeWidth={2.25} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>
              fleetlens
            </div>
            <div style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>local dashboard</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "10px 10px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
        <NavLink href="/" active={pathname === "/"} icon={<LayoutDashboard size={15} />}>
          Overview
        </NavLink>
        <NavLink
          href="/sessions"
          active={pathname === "/sessions" || pathname.startsWith("/sessions/")}
          icon={<ListTree size={15} />}
          trailing={totalSessions > 0 ? String(totalSessions) : undefined}
        >
          All sessions
        </NavLink>
        <NavLink
          href="/projects"
          active={pathname === "/projects"}
          icon={<FolderOpen size={15} />}
          trailing={projects.length > 0 ? String(projects.length) : undefined}
        >
          Projects
        </NavLink>
        <NavLink
          href="/parallelism"
          active={pathname === "/parallelism"}
          icon={<GitBranch size={15} />}
        >
          Timeline
        </NavLink>
        <NavLink
          href="/usage"
          active={pathname === "/usage"}
          icon={<Gauge size={15} />}
        >
          Usage
        </NavLink>
      </nav>

      {/* Projects search + list */}
      <div
        style={{
          margin: "0 14px",
          padding: "8px 0",
          borderTop: "1px solid var(--af-border-subtle)",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Search size={13} color="var(--af-text-tertiary)" />
        <input
          type="text"
          placeholder="Search projects"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            padding: "4px 0",
            fontSize: 12,
            color: "var(--af-text)",
          }}
        />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "4px 8px 20px" }}>
        {hydrated && pinned.length > 0 && (
          <ProjectSection
            label="Pinned"
            items={pinned}
            pathname={pathname}
            isPinned={(d) => pins.has(d)}
            onTogglePin={togglePin}
          />
        )}
        <ProjectSection
          label="Projects"
          items={unpinned}
          pathname={pathname}
          isPinned={(d) => pins.has(d)}
          onTogglePin={togglePin}
        />
      </div>

      <UsageSidebar snapshot={currentUsage} />

      <div
        style={{
          padding: "10px 16px 10px 20px",
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          borderTop: "1px solid var(--af-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          {totalSessions} sessions · {projects.length} projects
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function NavLink({
  href,
  active,
  icon,
  trailing,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  trailing?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: 500,
        color: active ? "var(--af-accent)" : "var(--af-text-secondary)",
        background: active ? "var(--af-accent-subtle)" : "transparent",
        transition: "all 0.12s",
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{children}</span>
      {trailing && (
        <span
          style={{
            fontSize: 10,
            color: active ? "var(--af-accent)" : "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {trailing}
        </span>
      )}
    </Link>
  );
}

function ProjectSection({
  label,
  items,
  pathname,
  isPinned,
  onTogglePin,
}: {
  label: string;
  items: ProjectRef[];
  pathname: string;
  isPinned: (dir: string) => boolean;
  onTogglePin: (dir: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          padding: "0 10px 6px",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((p) => {
          const href = `/projects/${encodeURIComponent(p.projectDir)}`;
          const active = pathname === href;
          const pretty = prettyProjectName(p.projectName);
          return (
            <div
              key={p.projectDir}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 6px 5px 10px",
                borderRadius: 6,
                background: active ? "var(--af-accent-subtle)" : "transparent",
                color: active ? "var(--af-accent)" : "var(--af-text-secondary)",
              }}
            >
              <Link
                href={href}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  color: "inherit",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
                title={
                  (p.worktreeCount ?? 0) > 0
                    ? `${p.projectName} — ${p.worktreeCount} worktree${p.worktreeCount === 1 ? "" : "s"}`
                    : p.projectName
                }
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {pretty}
                </span>
                {(p.worktreeCount ?? 0) > 0 && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "1px 5px",
                      borderRadius: 100,
                      background: "rgba(167, 139, 250, 0.15)",
                      color: "rgba(167, 139, 250, 1)",
                      flexShrink: 0,
                    }}
                  >
                    +{p.worktreeCount} wt
                  </span>
                )}
              </Link>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                  marginLeft: 4,
                }}
              >
                {p.sessionCount}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTogglePin(p.projectDir);
                }}
                aria-label={isPinned(p.projectDir) ? "Unpin project" : "Pin project"}
                title={isPinned(p.projectDir) ? "Unpin" : "Pin"}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 3,
                  borderRadius: 4,
                  color: isPinned(p.projectDir) ? "var(--af-accent)" : "var(--af-text-tertiary)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {isPinned(p.projectDir) ? <PinOff size={12} /> : <Pin size={12} />}
              </button>
              {p.lastActiveMs && (
                <span
                  style={{
                    fontSize: 9,
                    color: "var(--af-text-tertiary)",
                    marginLeft: 2,
                    minWidth: 32,
                    textAlign: "right",
                  }}
                  title={new Date(p.lastActiveMs).toISOString()}
                  // formatRelative is time-sensitive and the SSR value will be
                  // a few seconds stale by the time the client hydrates. This
                  // is exactly the case React's docs recommend suppressing.
                  suppressHydrationWarning
                >
                  {formatRelative(new Date(p.lastActiveMs).toISOString())}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
