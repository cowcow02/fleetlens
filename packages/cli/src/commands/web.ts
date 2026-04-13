import { getServerStatus, startServer, openBrowser } from "../server.js";

/**
 * `fleetlens web [page] [--no-open]` — open the dashboard in a browser.
 * Starts the server first if it's not already running.
 *
 * Examples:
 *   fleetlens web                      → http://localhost:3321/
 *   fleetlens web usage                → http://localhost:3321/usage
 *   fleetlens web sessions             → http://localhost:3321/sessions
 *   fleetlens web usage --no-open      → start server, print URL, skip browser
 */
export async function web(args: string[]): Promise<void> {
  const noOpen = args.includes("--no-open");
  const positional = args.filter((a) => !a.startsWith("--"));
  const rawPath = positional[0] ?? "";
  const path = rawPath.startsWith("/") ? rawPath : rawPath ? `/${rawPath}` : "";

  const status = getServerStatus();

  if (status.running) {
    const url = `http://localhost:${status.port}${path}`;
    console.log(noOpen ? `Server running at ${url}` : `Opening ${url}`);
    if (!noOpen) openBrowser(url);
    return;
  }

  console.log("fleetlens is not running. Starting server...");
  try {
    const result = await startServer({});
    const url = `http://localhost:${result.port}${path}`;
    console.log(`fleetlens running on ${url} (PID ${result.pid})`);
    if (!noOpen) openBrowser(url);
  } catch (err) {
    console.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
