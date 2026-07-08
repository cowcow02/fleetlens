import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireGroupManager } from "../../../../../../../lib/route-helpers";
import {
  countsTowardGroup,
  listIntegrations,
  normalizeGithubRepos,
  normalizeLinearTeams,
  normalizeJiraProjects,
  saveGithubIntegration,
  saveLinearIntegration,
  saveJiraIntegration,
  runSync,
  type IntegrationRow,
} from "../../../../../../../lib/integrations";

// Group-scoped view of integrations: org-level connections appear as source
// lists with a per-source "counts toward THIS group" boolean (never
// credentials, never other groups' inclusion state); connections owned by
// this group are fully manageable by its managers. Other groups' connections
// are invisible here.

async function groupCtx(req: NextRequest, slug: string, groupSlug: string) {
  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const group = await requireGroupManager(ctx, groupSlug);
  if (group instanceof NextResponse) return group;
  return { ctx, group };
}

function countsToward(groupIds: string[], groupId: string) {
  return {
    counts: countsTowardGroup(groupIds, groupId),
    via_all_groups: groupIds.length === 0,
  };
}

function sourcesFor(integ: IntegrationRow, groupId: string) {
  if (integ.provider === "github") {
    return normalizeGithubRepos(integ.config.repos).map((r) => ({ key: r.name, ...countsToward(r.group_ids, groupId) }));
  }
  if (integ.provider === "linear") {
    return normalizeLinearTeams(integ.config).map((t) => ({ key: t.key, ...countsToward(t.group_ids, groupId) }));
  }
  return normalizeJiraProjects(integ.config).map((p) => ({ key: p.key, ...countsToward(p.group_ids, groupId) }));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group: groupSlug } = await params;
  const res = await groupCtx(req, slug, groupSlug);
  if (res instanceof NextResponse) return res;
  const { ctx, group } = res;

  const all = await listIntegrations(ctx.membership.team_id, ctx.pool);
  const visible = all.filter((i) => i.owner_group_id === null || i.owner_group_id === group.id);

  return NextResponse.json({
    integrations: visible.map((i) => {
      const owned = i.owner_group_id === group.id;
      const config = i.config as { login?: string; site?: string };
      return {
        id: i.id,
        provider: i.provider,
        label: i.label,
        owned,
        sources: sourcesFor(i, group.id),
        // Operational detail only for connections this group manages —
        // org-level connections stay opaque beyond their source list.
        ...(owned
          ? {
              login: config.login ?? null,
              site: config.site ?? null,
              status: i.status,
              last_error: i.last_error,
              last_sync_at: i.last_sync_at,
            }
          : {}),
      };
    }),
  });
}

// Manager connect flow: a new integration owned by this group. Sources are
// forced to count toward the owner group only — a manager's connection must
// not leak into every group's report by default (admins can widen the
// mapping from org settings afterwards).
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; group: string }> }) {
  const { slug, group: groupSlug } = await params;
  const res = await groupCtx(req, slug, groupSlug);
  if (res instanceof NextResponse) return res;
  const { ctx, group } = res;

  if (!process.env.FLEETLENS_ENCRYPTION_KEY) {
    return NextResponse.json(
      { error: "FLEETLENS_ENCRYPTION_KEY env var must be set to store integration credentials at rest" },
      { status: 501 },
    );
  }

  const body = (await req.json()) as {
    provider?: string; label?: string;
    token?: string; repos?: unknown;                       // github
    apiKey?: string; teams?: unknown;                      // linear
    site?: string; email?: string; apiToken?: string; projects?: unknown; // jira
  };

  const provider = body.provider;
  if (provider !== "github" && provider !== "linear" && provider !== "jira") {
    return NextResponse.json({ error: "provider must be github, linear or jira" }, { status: 400 });
  }

  const base = {
    teamId: ctx.membership.team_id,
    id: null,
    label: body.label?.trim() || `${group.name} ${provider === "github" ? "GitHub" : provider === "jira" ? "Jira" : "Linear"}`,
    ownerGroupId: group.id,
    createdBy: ctx.user.id,
  };

  let saved: { id: string; login: string };
  try {
    if (provider === "github") {
      const repos = normalizeGithubRepos(body.repos).map((r) => ({ ...r, group_ids: [group.id] }));
      if (repos.length === 0) return NextResponse.json({ error: "select at least one repository" }, { status: 400 });
      if (repos.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r.name))) {
        return NextResponse.json({ error: "repos must be owner/name" }, { status: 400 });
      }
      saved = await saveGithubIntegration({ ...base, token: body.token?.trim() || null, repos }, ctx.pool);
    } else if (provider === "linear") {
      const teams = normalizeLinearTeams({ teams: body.teams }).map((t) => ({ ...t, group_ids: [group.id] }));
      if (teams.length === 0) return NextResponse.json({ error: "select at least one Linear team" }, { status: 400 });
      saved = await saveLinearIntegration({ ...base, apiKey: body.apiKey?.trim() || null, teams }, ctx.pool);
    } else {
      const projects = normalizeJiraProjects({ projects: body.projects }).map((p) => ({ ...p, group_ids: [group.id] }));
      if (projects.length === 0) return NextResponse.json({ error: "select at least one Jira project" }, { status: 400 });
      saved = await saveJiraIntegration(
        {
          ...base,
          site: body.site?.trim() || null,
          email: body.email?.trim() || null,
          token: body.apiToken?.trim() || null,
          projects,
        },
        ctx.pool,
      );
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Initial sync inline so the manager sees data immediately after connecting.
  try {
    const summary = await runSync(saved.id, provider, ctx.pool);
    return NextResponse.json({ saved: true, id: saved.id, login: saved.login, sync: summary });
  } catch (err) {
    return NextResponse.json({ saved: true, id: saved.id, login: saved.login, sync_error: (err as Error).message });
  }
}
