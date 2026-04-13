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
    case "version":
    case "--version":
    case "-v":
      console.log(`cclens ${CLI_VERSION}`);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(`Usage: cclens <command>

Commands:
  start [--port N]            Start the dashboard server
  stop                        Stop the dashboard server
  update                      Update to the latest version
  stats [--live] [-s D] [--days N]  Show token usage statistics
  version                     Print version`);
      break;
    default:
      console.error(`Unknown command: ${command}\nRun 'cclens help' for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
