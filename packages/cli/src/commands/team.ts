export async function team(args: string[]) {
  const sub = args[0];
  switch (sub) {
    case "join": {
      const { joinTeam } = await import("../team/join.js");
      await joinTeam(args.slice(1));
      break;
    }
    case "status": {
      const { teamStatus } = await import("../team/status.js");
      await teamStatus();
      break;
    }
    case "leave": {
      const { teamLeave } = await import("../team/leave.js");
      await teamLeave();
      break;
    }
    case "logs": {
      const { teamLogs } = await import("../team/logs.js");
      await teamLogs();
      break;
    }
    default:
      console.log(`Usage: fleetlens team <join|status|leave|logs>

  join <url> <token>    Pair with a team server using an invite token
  status                Show team pairing state and sync info
  leave                 Unpair from the team server
  logs                  Show recent team-related daemon log entries`);
  }
}
