import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { projectKey } from "@claude-lens/parser";
import { listAllSessions } from "@claude-lens/parser/fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  projectKey?: unknown;
  path?: unknown;
};

function openerFor(path: string): { cmd: string; args: string[] } {
  if (process.platform === "darwin") return { cmd: "open", args: [path] };
  if (process.platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", path] };
  return { cmd: "xdg-open", args: [path] };
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function sessionFoldersForProject(key: string): Promise<Set<string>> {
  return listAllSessions({ limit: 1000 }).then((sessions) => {
    const allowed = new Set<string>();
    for (const s of sessions) {
      if (projectKey(s.projectName) !== key) continue;
      if (s.cwd && isAbsolute(s.cwd)) allowed.add(s.cwd);
      if (isAbsolute(s.projectName)) allowed.add(s.projectName);
    }
    return allowed;
  });
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Body | null;
  const key = typeof body?.projectKey === "string" ? body.projectKey : "";
  const path = typeof body?.path === "string" ? body.path : "";

  if (!key || !path) {
    return Response.json({ error: "Missing project or folder path." }, { status: 400 });
  }
  if (!isAbsolute(path)) {
    return Response.json({ error: "Only absolute local folder paths can be opened." }, { status: 400 });
  }

  const allowed = await sessionFoldersForProject(key);
  if (!allowed.has(path)) {
    return Response.json({ error: "That folder is not part of this project." }, { status: 403 });
  }
  if (!isDirectory(path)) {
    return Response.json({ error: "That folder no longer exists locally." }, { status: 404 });
  }

  const { cmd, args } = openerFor(path);
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  return Response.json({ ok: true });
}
