"use client";

import { useEffect, useState } from "react";

/** Team-edition mobile-only top bar. Hidden via CSS above 900px.
 *  Tapping the menu toggles `ts-mobile-open` on <body>, which the CSS
 *  uses to overlay <nav.shell-nav> as a drawer. */
export function TeamMobileTopbar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("ts-mobile-open", open);
    return () => {
      document.body.classList.remove("ts-mobile-open");
    };
  }, [open]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 901) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".shell-nav a")) setOpen(false);
      else if (target.closest(".ts-mobile-topbar")) return;
      else if (!target.closest(".shell-nav")) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  return (
    <div className="ts-mobile-topbar">
      <a href="/" className="ts-mobile-topbar-brand">
        Fleet<em>lens</em>
      </a>
      <button
        type="button"
        className="ts-mobile-topbar-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "CLOSE" : "MENU"}
      </button>
    </div>
  );
}
