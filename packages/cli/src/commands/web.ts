import { getServerStatus, startServer, openBrowser } from "../server.js";

export async function web(args: string[]): Promise<void> {
  // --open opts into browser launch; --no-open is silently accepted as a no-op for backward compat.
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
      console.log(`Dashboard ready at ${url} (re-run with --open to launch it automatically).`);
    }
    return;
  }

  console.log("fleetlens is not running. Starting server...");
  try {
    const result = await startServer({});
    const url = `http://localhost:${result.port}${path}`;
    console.log(`fleetlens running on ${url} (PID ${result.pid})`);
    if (open) {
      openBrowser(url);
    } else {
      console.log(`Open ${url} in your browser, or re-run with --open to launch it automatically.`);
    }
  } catch (err) {
    console.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
