import Script from "next/script";

/**
 * Inline script that runs before React hydrates and picks up the
 * persisted theme (or system preference) so there's no flash of the
 * wrong theme on page load.
 *
 * This is a SERVER component (no "use client") because next/script
 * with strategy="beforeInteractive" must be rendered from a server
 * component in the root layout. Rendering it from a client component
 * triggers Next 16's "script tag inside React component" error.
 */
const STORAGE_KEY = "claude-lens:theme";

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

export function ThemeScript() {
  return (
    <Script id="claude-lens-theme-init" strategy="beforeInteractive">
      {code}
    </Script>
  );
}
