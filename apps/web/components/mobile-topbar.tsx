"use client";

import { useEffect, useState } from "react";

/** Mobile-only top bar with brand + hamburger.
 *
 *  Hidden via CSS above 900px (see globals.css). Tapping the hamburger
 *  toggles `.sl-sidebar-mobile-open` on <body>, which the CSS uses to
 *  overlay the existing <aside.sl-sidebar> as a drawer.
 */
export function MobileTopbar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const cls = "sl-sidebar-mobile-open";
    document.body.classList.toggle(cls, open);
    return () => {
      document.body.classList.remove(cls);
    };
  }, [open]);

  // Auto-close on resize past the breakpoint or on route change (anchor click).
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
      if (target.closest(".sl-sidebar a")) setOpen(false);
      else if (target.closest(".mobile-topbar")) return;
      else if (!target.closest(".sl-sidebar")) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  return (
    <div className="mobile-topbar">
      <a href="/" className="mobile-topbar-brand">
        Fleet<em>lens</em>
      </a>
      <button
        type="button"
        className="mobile-topbar-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close" : "Menu"}
      </button>
    </div>
  );
}
