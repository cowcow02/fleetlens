import { listSessions } from "@/lib/data";
import { projectRepoName, groupByProject } from "@claude-lens/parser";
import type { DayOutcome } from "@claude-lens/entries";
import { ProjectsView, type ProjectRow } from "./projects-view";
import { buildEntriesIndex } from "@/lib/entries-index";

export const dynamic = "force-dynamic";

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

export default async function ProjectsPage() {
  const [sessions, index] = await Promise.all([listSessions(), buildEntriesIndex()]);
  const projects = groupByProject(sessions);
  const days = lastNDays(7);

  const rows: ProjectRow[] = projects.map((p) => {
    const projectEntries = index.byProject.get(projectRepoName(p.projectName)) ?? [];
    const byDay = new Map<string, typeof projectEntries>();
    for (const e of projectEntries) {
      const arr = byDay.get(e.local_day);
      if (arr) arr.push(e); else byDay.set(e.local_day, [e]);
    }
    const recent: Array<{ date: string; outcome: DayOutcome | null }> = days.map((d) => {
      const list = byDay.get(d) ?? [];
      let best: DayOutcome | null = null;
      let bestPri = 0;
      const pri: Record<string, number> = {
        shipped: 6, partial: 5, blocked: 4, exploratory: 3, trivial: 2, idle: 1,
      };
      for (const e of list) {
        const o = e.enrichment.outcome;
        if (!o) continue;
        if ((pri[o] ?? 0) > bestPri) {
          bestPri = pri[o] ?? 0;
          best = o as DayOutcome;
        }
      }
      return { date: d, outcome: best };
    });
    return { project: p, recentDays: recent };
  });

  return (
    <div style={{ maxWidth: 1280, padding: "32px 40px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
          Projects
        </h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          {projects.length} project{projects.length === 1 ? "" : "s"} across{" "}
          {sessions.length} session{sessions.length === 1 ? "" : "s"}.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="af-empty">No projects found.</div>
      ) : (
        <ProjectsView rows={rows} />
      )}
    </div>
  );
}
