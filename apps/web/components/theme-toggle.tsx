"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "claude-sessions:theme";

function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // ignore
  }
  return null;
}

function systemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Theme toggle button.
 *
 * The initial theme is set **before** React hydrates via an inline
 * script in `app/layout.tsx` (see ThemeScript), so there's no FOUC.
 * This component only handles the click interaction and keeps the
 * icon in sync after a user toggle.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [hydrated, setHydrated] = useState(false);

  // Read the actual current theme set by ThemeScript before React took over.
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") {
      setTheme(attr);
    } else {
      const resolved = readStoredTheme() ?? systemTheme();
      setTheme(resolved);
      applyTheme(resolved);
    }
    setHydrated(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  // Render a stable placeholder on first paint so SSR and client match.
  // Once hydrated we know which icon to show.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 6,
        background: "transparent",
        border: "1px solid var(--af-border-subtle)",
        color: "var(--af-text-secondary)",
        cursor: "pointer",
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--af-surface-hover)";
        e.currentTarget.style.color = "var(--af-text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--af-text-secondary)";
      }}
    >
      {!hydrated ? null : theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

/**
 * Inline script that runs before React hydrates and picks up the
 * persisted theme (or system preference) so there's no flash of the
 * wrong theme on page load. Mount this inside <head>.
 */
export function ThemeScript() {
  const code = `
(function(){
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var theme = (stored === 'light' || stored === 'dark')
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
