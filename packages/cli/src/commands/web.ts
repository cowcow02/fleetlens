import { getServerStatus, startServer, openBrowser } from "../server.js";

/**
 * `fleetlens web [page] [--open]` — print the dashboard URL (and start the
 * server first if it's not already running). Pass `--open` to also launch
 * the URL in your browser; the legacy `--no-open` flag is still accepted as
 * a no-op since "don't open" is now the default.
 *
 * Examples:
 *   fleetlens web                      → http://localhost:3321/
 *   fleetlens web usage                → http://localhost:3321/usage
 *   fleetlens web sessions             → http://localhost:3321/sessions
 *   fleetlens web usage --open         → start server, print URL, open browser
 */
export async function web(args: string[]): Promise<void> {
  const open = args.includes("--open");
  const positional = args.filter((a) => !a.startsWith("--"));
  const rawPath = positional[0] ?? "";
  const path = rawPath.startsWith("/") ? rawPath : rawPath ? `/${rawPath}` : "";

  const status = getServerStatus();

  if (status.running) {
    const url = `http://localhost:${status.port}${path}`;
    if (open) {
      console.log(`Opening ${url}`);
      openBrowser(url);
    } else {
      console.log(`Dashboard ready at ${url}`);
    }
    return;
  }

  console.log("fleetlens is not running. Starting server...");
  try {
    const result = await startServer({});
    const url = `http://localhost:${result.port}${path}`;
    console.log(`fleetlens running on ${url} (PID ${result.pid})`);
    if (open) openBrowser(url);
  } catch (err) {
    console.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
