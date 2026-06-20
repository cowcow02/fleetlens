"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export type SelectOption = { value: string; label: string };

/** A native <select> can't be filtered, which is painful once there are dozens
 *  of options (e.g. the project list across many folders). This is a drop-in
 *  combobox: click to open, type to filter by label, arrow/Enter/Escape to
 *  navigate. Selection is still a single string value via onChange. */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Type to filter…",
  maxWidth = 260,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  maxWidth?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.label.toLowerCase().includes(s));
  }, [q, options]);

  // On open only: clear the filter and highlight the current value (a native
  // select opens on its selection), then focus the search box. Deps are [open]
  // alone on purpose — `options` is a fresh array each parent render, so
  // including it would reset the filter mid-typing.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the active option scrolled into view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Close and return focus to the trigger (a native select refocuses itself).
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const choose = (v: string) => {
    onChange(v);
    close();
  };

  const activeId = filtered[active] ? optionId(active) : undefined;

  return (
    <div style={{ position: "relative", maxWidth }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: "var(--background)",
          border: `1px solid ${open ? "var(--af-accent)" : "var(--af-border-subtle)"}`,
          borderRadius: 8,
          padding: "9px 12px",
          color: "var(--af-text)",
          fontSize: 13,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: selected ? "var(--af-text)" : "var(--af-text-tertiary)",
          }}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={13} style={{ marginLeft: "auto", flexShrink: 0, color: "var(--af-text-tertiary)" }} />
      </button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              minWidth: "100%",
              width: "max-content",
              maxWidth: 380,
              zIndex: 41,
              background: "var(--af-surface)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "relative", padding: 6, borderBottom: "1px solid var(--af-border-subtle)" }}>
              <Search
                size={12}
                style={{ position: "absolute", left: 15, top: "50%", transform: "translateY(-50%)", color: "var(--af-text-tertiary)" }}
              />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={activeId}
                aria-autocomplete="list"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0); // typing narrows the list; keep the highlight on a real row
                }}
                placeholder={searchPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, Math.max(0, filtered.length - 1)));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const opt = filtered[active];
                    if (opt) choose(opt.value);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                  }
                }}
                style={{ width: "100%", paddingLeft: 30, fontSize: 12 }}
              />
            </div>
            <div ref={listRef} role="listbox" id={listboxId} style={{ maxHeight: 300, overflowY: "auto", padding: 4 }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--af-text-tertiary)" }}>No matches</div>
              ) : (
                filtered.map((o, i) => (
                  <button
                    key={o.value}
                    id={optionId(i)}
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onClick={() => choose(o.value)}
                    onMouseEnter={() => setActive(i)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 10px",
                      fontSize: 12,
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      background: i === active ? "var(--af-surface-hover)" : "transparent",
                      color: o.value === value ? "var(--af-accent)" : "var(--af-text)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {o.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
