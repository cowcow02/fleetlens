import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Expose the request pathname to server components via a request header so
// the root layout can skip rendering chrome (sidebar, floating widgets) on
// /print/* routes used by the PDF export.
export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-fleetlens-pathname", req.nextUrl.pathname);
  // Headless Chrome doesn't inherit the user's theme cookie, so the PDF API
  // forwards the theme as a ?theme= query param. Surface it as a header so
  // the root layout can apply it to <html data-theme> for /print/* renders.
  const theme = req.nextUrl.searchParams.get("theme");
  if (theme === "light" || theme === "dark") {
    requestHeaders.set("x-fleetlens-theme", theme);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
