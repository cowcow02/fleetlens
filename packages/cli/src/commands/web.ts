import { getServerStatus, startServer, openBrowser } from "../server.js";

/**
 * `cclens web [page]` — open the dashboard in a browser.
 * Starts the server first if it's not already running.
 *
 * Examples:
 *   cclens web           → http://localhost:3321/
 *   cclens web usage     → http://localhost:3321/usage
 *   cclens web sessions  → http://localhost:3321/sessions
 */
export async function web(args: string[]): Promise<void> {
  const rawPath = args[0] ?? "";
  const path = rawPath.startsWith("/") ? rawPath : rawPath ? `/${rawPath}` : "";

  const status = getServerStatus();

  if (status.running) {
    const url = `http://localhost:${status.port}${path}`;
    console.log(`Opening ${url}`);
    openBrowser(url);
    return;
  }

  console.log("Claude Lens is not running. Starting server...");
  try {
    const result = await startServer({});
    const url = `http://localhost:${result.port}${path}`;
    console.log(`Claude Lens running on ${url} (PID ${result.pid})`);
    openBrowser(url);
  } catch (err) {
    console.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
