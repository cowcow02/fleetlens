import { ensureCurrentServer, openBrowser } from "../server.js";

export async function web(args: string[]): Promise<void> {
  // --open opts into browser launch; --no-open is silently accepted as a no-op for backward compat.
  const open = args.includes("--open");
  const positional = args.filter((a) => !a.startsWith("--"));
  const rawPath = positional[0] ?? "";
  const path = rawPath.startsWith("/") ? rawPath : rawPath ? `/${rawPath}` : "";

  // Reuse a healthy same-version server; cycle a stale one so the printed
  // URL never points at an old, possibly broken, bundle.
  let result;
  try {
    result = await ensureCurrentServer({});
  } catch (err) {
    console.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }

  const url = `http://localhost:${result.port}${path}`;
  if (result.restarted) {
    console.log(`fleetlens restarted on http://localhost:${result.port} (PID ${result.pid}) — replaced stale ${result.previousVersion ?? "unknown"} server`);
  }
  if (open) {
    console.log(`Opening ${url}`);
    openBrowser(url);
  } else {
    console.log(`Dashboard ready at ${url} (re-run with --open to launch it automatically).`);
  }
}
