import { stopServer, getServerStatus } from "../server.js";

export async function stop(): Promise<void> {
  const status = getServerStatus();
  if (!status.running) {
    console.log("fleetlens is not running.");
    return;
  }

  const result = stopServer();
  if (result.stopped) {
    console.log(`Stopped fleetlens (PID ${result.pid})`);
  }
}
