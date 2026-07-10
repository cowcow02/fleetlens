#!/usr/bin/env node
/**
 * Smoke-test verification: hits each route on the local dev server
 * and fails if any returns a non-2xx. Intended to be run after code
 * changes to catch server-component errors that typecheck can't find
 * (e.g. importing a client module from a server component, runtime
 * errors in RSC loaders).
 *
 * Prereqs: dev server must already be running on http://localhost:3321.
 * Run from the repo root: `node scripts/smoke.mjs`
 *
 * Exit code: 0 if all routes succeed, 1 otherwise.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
// Import the real resolver rather than mirroring it — a second copy of project
// identity silently drifts from the one the server actually uses. Requires a
// built parser, which the dev server this script targets already depends on.
import { projectKey } from "../packages/parser/dist/index.js";
import { resolveProjectIdentity } from "../packages/parser/dist/fs.js";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3321";
const TIMEOUT_MS = 30_000;

const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (r.ok || r.status === 500) return true; // 500 is fine, we'll catch it in the actual test
    } catch {
      // not ready yet
    }
    await sleep(300);
  }
  return false;
}

async function hit(path, label) {
  const url = `${BASE}${path}`;
  const start = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const dur = Date.now() - start;
    const body = await r.text();

    // Next.js error pages are HTML 500s; grep the body for obvious markers.
    const hasErrorBoundary = /__next_error|Runtime Error|Application error/i.test(body);
    const ok = r.ok && !hasErrorBoundary;

    if (ok) {
      console.log(`${GREEN}✓${RESET} ${label.padEnd(30)} ${DIM}${fmtMs(dur)}${RESET} ${DIM}${url}${RESET}`);
      return { ok: true, body };
    } else {
      const snippet = body.slice(0, 400).replace(/\s+/g, " ");
      console.log(
        `${RED}✗${RESET} ${label.padEnd(30)} ${DIM}${fmtMs(dur)}${RESET} ${RED}${r.status}${RESET} ${url}\n   ${DIM}${snippet}${RESET}`,
      );
      return { ok: false, status: r.status, snippet };
    }
  } catch (e) {
    console.log(
      `${RED}✗${RESET} ${label.padEnd(30)} ${RED}${e instanceof Error ? e.message : String(e)}${RESET} ${url}`,
    );
    return { ok: false, error: String(e) };
  }
}

async function pickFirstSessionId() {
  try {
    const root = join(homedir(), ".claude", "projects");
    const projects = await readdir(root);
    for (const p of projects) {
      try {
        const files = await readdir(join(root, p));
        const jsonl = files.find((f) => f.endsWith(".jsonl"));
        if (jsonl) return jsonl.replace(/\.jsonl$/, "");
      } catch {
        // skip
      }
    }
  } catch {
    // no .claude/projects — fall through
  }
  return null;
}

/**
 * Walk ~/.claude/projects/ looking for a session JSONL whose meta/system
 * events mention a team name but no agent name — that's the lead session
 * and is what surfaces the Team tab in the UI. Reads only the first ~50
 * lines of each file to keep this cheap.
 */
async function findTeamLeadSession() {
  try {
    const root = join(homedir(), ".claude", "projects");
    const projects = await readdir(root, { withFileTypes: true });
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      let files;
      try {
        files = await readdir(join(root, p.name));
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        try {
          const raw = await readFile(join(root, p.name, f), "utf8");
          // Match the parser's isTeamLead rule: teamName present, agentName
          // absent, and at least one orchestration signal — TeamCreate or an
          // outbound SendMessage to a non-lead recipient. A bare teamName
          // tag is just an environmental artifact (Claude Code attaches it
          // to any chat opened in a /team window) and isn't enough to
          // surface a Team tab in the UI.
          const lines = raw.split("\n").slice(0, 200);
          let hasTeam = false;
          let hasAgent = false;
          let hasTeamCreate = false;
          let hasOutboundDispatch = false;
          for (const line of lines) {
            if (!line.trim()) continue;
            if (line.includes('"teamName"')) hasTeam = true;
            if (line.includes('"agentName"')) hasAgent = true;
            if (line.includes('"name":"TeamCreate"')) hasTeamCreate = true;
            if (
              line.includes('"name":"SendMessage"') &&
              line.includes('"to":"') &&
              !line.includes('"to":"team-lead"')
            ) {
              hasOutboundDispatch = true;
            }
          }
          if (hasTeam && !hasAgent && (hasTeamCreate || hasOutboundDispatch)) {
            return { sessionId: f.replace(/\.jsonl$/, "") };
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // no .claude/projects — fall through
  }
  return null;
}

function projectSlug(cwd) {
  return projectKey(resolveProjectIdentity(cwd).projectName);
}

async function pickFirstProjectSlug() {
  try {
    const root = join(homedir(), ".claude", "projects");
    const projects = await readdir(root, { withFileTypes: true });
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      try {
        const files = await readdir(join(root, p.name));
        const jsonl = files.find((f) => f.endsWith(".jsonl"));
        if (!jsonl) continue;
        // Read the first non-empty line to extract cwd from the JSONL.
        const raw = await readFile(join(root, p.name, jsonl), "utf8");
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (typeof obj?.cwd === "string") {
              return projectSlug(obj.cwd);
            }
          } catch {
            // skip malformed line
          }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // none
  }
  return null;
}

async function main() {
  console.log(`${CYAN}→${RESET} smoke testing ${BASE}\n`);

  const up = await waitForServer();
  if (!up) {
    console.log(`${RED}✗ dev server not reachable at ${BASE}${RESET}`);
    console.log(`  start it with:  pnpm -F @claude-lens/web dev`);
    process.exit(1);
  }

  const [sessionId, projectSlug, teamLead] = await Promise.all([
    pickFirstSessionId(),
    pickFirstProjectSlug(),
    findTeamLeadSession(),
  ]);

  const results = [];
  results.push(await hit("/", "Dashboard (all)"));
  results.push(await hit("/?range=7d", "Dashboard (7D)"));
  results.push(await hit("/?range=30d", "Dashboard (30D)"));
  results.push(await hit("/sessions", "Sessions list"));
  results.push(await hit("/projects", "Projects grid"));
  results.push(await hit("/settings", "Settings"));
  results.push(await hit("/insights", "Insights (V2 hero)"));
  results.push(await hit("/assistant", "Assistant chat"));
  results.push(await hit("/api/assistant/index", "Assistant index stats API"));
  results.push(await hit("/team", "Team sync"));
  // Unpaired dev servers redirect this to /team (200 via fetch's default
  // follow) — still exercises the onboarding page's server component.
  results.push(await hit("/team/onboarding", "Team onboarding wizard"));
  results.push(await hit("/changelog", "Changelog"));
  results.push(await hit("/api/digest/week-index?count=4", "Week index API"));
  results.push(await hit("/api/digest/month-index?count=3", "Month index API"));
  results.push(await hit("/day", "Day (today, via redirect)"));
  // Compute yesterday in the runner's local TZ so the route isn't flaky around midnight.
  const _y = new Date(Date.now() - 86_400_000);
  const yesterday = `${_y.getFullYear()}-${String(_y.getMonth() + 1).padStart(2, "0")}-${String(_y.getDate()).padStart(2, "0")}`;
  results.push(await hit(`/day/${yesterday}`, "Day view (yesterday)"));
  if (sessionId) {
    results.push(await hit(`/sessions/${sessionId}`, "Session detail"));
  } else {
    console.log(`${DIM}— skipping session detail (no .claude/projects data)${RESET}`);
  }
  if (projectSlug) {
    results.push(
      await hit(`/projects/${encodeURIComponent(projectSlug)}`, "Project detail"),
    );
  } else {
    console.log(`${DIM}— skipping project detail (no .claude/projects data)${RESET}`);
  }

  if (teamLead) {
    const r = await hit(
      `/sessions/${teamLead.sessionId}`,
      "Team lead session",
    );
    results.push(r);
    if (r.ok && r.body) {
      // The Team tab button is the third `af-tab-btn` rendered on a
      // team-lead session page. If it's missing, the team prop wasn't
      // plumbed through or loadTeamForSession returned null.
      const hasTeamTab = /af-tab-btn[^"']*["'][^>]*>\s*Team\s*</.test(r.body);
      if (!hasTeamTab) {
        console.log(
          `${RED}✗${RESET} Team tab button not found in team-lead page body`,
        );
        process.exitCode = 1;
        results.push({ ok: false });
      } else {
        console.log(
          `${GREEN}✓${RESET} ${"Team tab button present".padEnd(30)} ${DIM}/sessions/${teamLead.sessionId}${RESET}`,
        );
      }
    }
  } else {
    console.log(
      `${DIM}— skipping Team tab assertion (no local team-lead session found)${RESET}`,
    );
  }

  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  console.log();
  if (failed > 0) {
    console.log(`${RED}✗ ${failed}/${total} routes failed${RESET}`);
    process.exit(1);
  } else {
    console.log(`${GREEN}✓ all ${total} routes ok${RESET}`);
  }
}

main().catch((e) => {
  console.error(`${RED}smoke runner crashed:${RESET}`, e);
  process.exit(1);
});
