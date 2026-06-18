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
    case "usage": {
      const { usage } = await import("./commands/usage.js");
      await usage(args.slice(1));
      break;
    }
    case "entries": {
      const { entries } = await import("./commands/entries.js");
      await entries(args.slice(1));
      break;
    }
    case "digest": {
      const { digest } = await import("./commands/digest.js");
      await digest(args.slice(1));
      break;
    }
    case "daemon": {
      const { daemon } = await import("./commands/daemon.js");
      await daemon(args.slice(1));
      break;
    }
    case "autostart": {
      const { autostart } = await import("./commands/autostart.js");
      await autostart(args.slice(1));
      break;
    }
    case "team": {
      const { team } = await import("./commands/team.js");
      await team(args.slice(1));
      break;
    }
    case "runs": {
      const { runs } = await import("./commands/runs.js");
      await runs(args.slice(1));
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
  start [--port N] [--open]         Start dashboard + usage daemon (prints URL; pass --open to also launch browser)
  stop                              Stop dashboard + usage daemon
  status                            Show server + daemon + latest snapshot
  update                            Update to the latest version

Terminal:
  usage [--save]                             Plan utilization snapshot (5h/7d)
  usage --history [-s D] [--days N]          Daily token/cost table
  entries [--day D|--session ID|--all] [--json]    Perception-layer entries
  digest day   [--date D|--yesterday|--today] [--json]    Day digest
  digest week  [--week D|--last-week|--this-week] [--json]   Week digest
  digest month [--month YYYY-MM|--last-month|--this-month] [--json]  Month digest
  runs [--watch] [--json] [--since 24h]      Live LLM call activity + token spend

Advanced:
  web [page] [--open]               Print dashboard URL without auto-starting daemon (pass --open to also launch browser)
  start --no-daemon                 Start only the web server (no daemon)
  daemon <start|stop|status|logs>   Manage the usage daemon by itself
  autostart <install|uninstall|status>   Run the usage daemon at login (macOS launchd)

Team:
  team join <url> <token>           Pair with a team server
  team status                       Show team pairing state
  team leave                        Unpair from team server
  team logs                         Show team-related daemon logs

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
