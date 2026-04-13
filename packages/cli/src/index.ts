declare const CLI_VERSION: string;

const args = process.argv.slice(2);
const command = args[0] ?? "help";

async function main() {
  switch (command) {
    case "start": {
      const { start } = await import("./commands/start.js");
      await start(args.slice(1));
      break;
    }
    case "stop": {
      const { stop } = await import("./commands/stop.js");
      await stop();
      break;
    }
    case "status": {
      const { status } = await import("./commands/status.js");
      await status();
      break;
    }
    case "web": {
      const { web } = await import("./commands/web.js");
      await web(args.slice(1));
      break;
    }
    case "update": {
      const { update } = await import("./commands/update.js");
      await update();
      break;
    }
    case "stats": {
      const { stats } = await import("./commands/stats.js");
      await stats(args.slice(1));
      break;
    }
    case "usage": {
      const { usage } = await import("./commands/usage.js");
      await usage(args.slice(1));
      break;
    }
    case "daemon": {
      const { daemon } = await import("./commands/daemon.js");
      await daemon(args.slice(1));
      break;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(`fleetlens ${CLI_VERSION}`);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(`Usage: fleetlens <command>

Common:
  start [--port N] [--no-open]      Start dashboard + usage daemon
  stop                              Stop dashboard + usage daemon
  status                            Show server + daemon + latest snapshot
  update                            Update to the latest version

Terminal:
  stats [--live] [-s D] [--days N]  Daily token usage table
  usage [--save]                    Plan utilization (5h/7d) in one shot

Advanced:
  web [page] [--no-open]            Open dashboard in browser without auto-starting daemon
  start --no-daemon                 Start only the web server (no daemon)
  daemon <start|stop|status|logs>   Manage the usage daemon by itself

  version                           Print version`);
      break;
    default:
      console.error(`Unknown command: ${command}\nRun 'fleetlens help' for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
