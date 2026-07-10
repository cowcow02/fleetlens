/** The model sometimes cites things that aren't linkable — memory-file
 *  names, repo paths — and a relative href silently resolves against the
 *  page origin into a dead localhost URL. Only two destinations are real:
 *  session pages and absolute web URLs; everything else renders as text. */
export function classifyHref(href: string | undefined): "session" | "external" | "text" {
  if (!href) return "text";
  if (href.startsWith("/sessions/")) return "session";
  if (/^https?:\/\//.test(href)) return "external";
  return "text";
}
