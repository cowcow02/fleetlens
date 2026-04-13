import { stopServer, getServerStatus } from "../server.js";
import { stopDaemonSilent } from "./daemon.js";

/**
 * `fleetlens stop` — tear down both the web server and the usage daemon
 * together. Leaving the daemon running after stopping the UI is almost
 * always a mistake (it keeps polling but nothing consumes the data), so
 * the default stops both.
 */
export async function stop(): Promise<void> {
  let didSomething = false;

  // --- Web server ---
  const status = getServerStatus();
  if (status.running) {
    const result = stopServer();
    if (result.stopped) {
      console.log(`Server:  stopped (PID ${result.pid})`);
      didSomething = true;
    }
  } else {
    console.log("Server:  not running");
  }

  // --- Usage daemon ---
  const daemon = stopDaemonSilent();
  if (daemon.stopped) {
    console.log(`Daemon:  stopped (PID ${daemon.pid})`);
    didSomething = true;
  } else {
    console.log("Daemon:  not running");
  }

  if (!didSomething) {
    console.log("Fleetlens is not running.");
  }
}
