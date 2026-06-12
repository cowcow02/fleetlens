import type {
  CadenceSnapshot,
  BreadthSnapshot,
  HarnessBreakdown,
  LiveExtras,
  MaturityEvidence,
  MaturityLevel,
  MaturityMemberClassification,
  MaturityPath,
  MemberMaturityPortrait,
  TeamInsightReport,
} from "../app/team/[slug]/insights/types";
import type { MomentumTrendWeek } from "./insights-aggregate";
import { recommend, type MemberStats } from "./plan-optimizer";
import { tierEntry, type PlanTierKey } from "./plan-tiers";
import type { SeatCandidate } from "../components/seat-right-sizing";
import { mockTeamInsightReport } from "./insights-mock-data";

// Synthesize a per-group report for the REAL roster without touching the DB —
// powers the ?mock=1 view so a team can be demoed with real names but no seeded
// activity rows. Deterministic (no Math.random/Date) so refreshes are stable.

export type MockRealMember = { membershipId: string; name: string; tier: string };

export type MockGroupData = {
  report: TeamInsightReport;
  trend: MomentumTrendWeek[];
  seatCandidates: SeatCandidate[];
  seatReviewed: number;
  seatInsufficient: number;
  membersTotal: number;
  activeCount: number;
};

// Plausible spread: one multiplier, a couple integrated, then settling levels.
const LEVEL_CYCLE: MaturityLevel[] = ["L4", "L3", "L3", "L2", "L1", "L0"];

type Profile = {
  activeDays7: number; activeDays30: number; sessions30: number;
  projects: number; skills: number; subagents: number;
  prsWk: number; agentHoursWk: number; planMode: boolean; longAuto: number;
};
const PROFILE: Record<MaturityLevel, Profile> = {
  L4: { activeDays7: 5, activeDays30: 22, sessions30: 96, projects: 3, skills: 6, subagents: 3, prsWk: 8, agentHoursWk: 9.4, planMode: true, longAuto: 6 },
  L3: { activeDays7: 5, activeDays30: 18, sessions30: 62, projects: 3, skills: 5, subagents: 2, prsWk: 5, agentHoursWk: 6.1, planMode: true, longAuto: 3 },
  L2: { activeDays7: 3, activeDays30: 10, sessions30: 24, projects: 1, skills: 2, subagents: 0, prsWk: 1, agentHoursWk: 3.0, planMode: false, longAuto: 0 },
  L1: { activeDays7: 2, activeDays30: 5,  sessions30: 8,  projects: 1, skills: 1, subagents: 0, prsWk: 0, agentHoursWk: 1.2, planMode: false, longAuto: 0 },
  L0: { activeDays7: 0, activeDays30: 0,  sessions30: 0,  projects: 0, skills: 0, subagents: 0, prsWk: 0, agentHoursWk: 0,   planMode: false, longAuto: 0 },
};

function portrait(name: string, level: MaturityLevel, isAuthor: boolean, adopters: number): MemberMaturityPortrait {
  const p = PROFILE[level];
  const cadence: CadenceSnapshot = {
    active_days_30d: p.activeDays30,
    active_days_7d: p.activeDays7,
    cadence_pct_30d: Math.round((p.activeDays30 / 30) * 100),
    sessions_30d: p.sessions30,
    sessions_7d: Math.round(p.sessions30 / 4),
    sessions_per_active_day_avg: p.activeDays30 ? Math.round((p.sessions30 / p.activeDays30) * 10) / 10 : 0,
  };
  const breadth: BreadthSnapshot = {
    distinct_projects_30d: p.projects,
    distinct_projects_7d: Math.min(p.projects, 3),
    distinct_skills_30d: p.skills,
    distinct_subagent_kinds_30d: p.subagents,
  };
  const harness: HarnessBreakdown = {
    skills_authored_30d: isAuthor ? 2 : 0,
    subagents_authored_30d: isAuthor ? 1 : 0,
    slash_commands_authored_30d: 0,
    claudemd_line_delta_30d: isAuthor ? 24 : 0,
    cross_member_adopters_30d: isAuthor ? adopters : 0,
  };
  const qualifying_paths: MaturityPath[] = [];
  const near_miss_paths: MaturityPath[] = [];
  const evidence: MaturityEvidence[] = [];
  let summary: string;
  if (level === "L0") {
    summary = `${name} hasn't engaged with the agent in the trailing 30 days — an onboarding gap worth checking on.`;
    evidence.push({ kind: "decisive", text: "No sessions observed in the trailing 30-day window", source_tag: "framing" });
  } else if (level === "L4") {
    qualifying_paths.push("L4-builds", "L3-multi-workflow", "L3-daily-active");
    if (adopters > 0) qualifying_paths.push("L4-coaches");
    summary = `${name} is operating as a multiplier — building shared toolchain (2 user-skill files authored, CLAUDE.md edits (24 lines))${adopters > 0 ? ` and seeing those artifacts picked up by ${adopters} other ${adopters === 1 ? "member" : "members"}` : ""}. Sustained presence across ${p.activeDays7} active days this week.`;
    evidence.push(
      { kind: "decisive", text: "Authored 2 user-skill files in trailing 30 days", count: 2, source_tag: "artifact_authored" },
      { kind: "decisive", text: "Edited CLAUDE.md (+24 lines net) — project-specific agent guidance", count: 24, source_tag: "artifact_authored" },
    );
    if (adopters > 0) evidence.push({ kind: "decisive", text: `Authored artifacts loaded by ${adopters} other group member${adopters === 1 ? "" : "s"} — cross-member adoption`, count: adopters, source_tag: "artifact_authored" });
    else near_miss_paths.push("L4-coaches");
  } else if (level === "L3") {
    qualifying_paths.push("L3-daily-active", "L3-multi-workflow");
    near_miss_paths.push("L4-builds");
    summary = `${name} engages with the agent daily across ${p.projects} projects and ${p.skills} distinct skills. The next growth edge is artifact authoring — a CLAUDE.md edit or a skill committed to the team catalog would surface the L4 builds path.`;
    evidence.push(
      { kind: "decisive", text: `Sessions span ${p.projects} projects and ${p.skills} distinct skills — workflow breadth`, count: p.skills, source_tag: "intent_category" },
      { kind: "supporting", text: `${p.activeDays7} active days this week — sustained, not bursty`, count: p.activeDays7 },
    );
  } else if (level === "L2") {
    qualifying_paths.push("L2-settled-pattern");
    summary = `${name} has a settled weekly pattern — ${p.sessions30} sessions across the month on a focused set of work. Broadening to more projects or skills is the path toward L3.`;
    evidence.push({ kind: "decisive", text: `${p.sessions30} sessions over 30 days on a steady cadence`, count: p.sessions30 });
  } else {
    qualifying_paths.push("L1-exploring");
    summary = `${name} is still exploring — a handful of sessions this month. Regular weekly use is the next step.`;
    evidence.push({ kind: "decisive", text: `${p.sessions30} sessions this month — early exploration`, count: p.sessions30 });
  }
  return {
    member: name, level, qualifying_paths, near_miss_paths,
    qualitative_summary: summary, cadence, breadth, harness, evidence,
    style_observations: [], trend: "stable",
  };
}

function mixCue(pt: MemberMaturityPortrait): string {
  const { cadence: c, breadth: b, harness: h, level } = pt;
  if (level === "L0") return "no activity in trailing 30d";
  if (level === "L4") {
    const bits: string[] = ["authors shared toolchain"];
    if (h.cross_member_adopters_30d > 0) bits.push(`${h.cross_member_adopters_30d} in-group adopter${h.cross_member_adopters_30d === 1 ? "" : "s"}`);
    return bits.join(" · ");
  }
  return `${c.active_days_7d} active days · ${b.distinct_projects_30d} projects · ${b.distinct_skills_30d} skills`;
}

function statsFor(level: MaturityLevel, isAuthor: boolean): MemberStats {
  // Heavy users / authors run hot; a non-author on a big seat runs cool.
  if (isAuthor) return { worstSevenDayPeak: 92, avgSevenDayAvg: 76, worstFiveHourPeak: 80, worstOpusPeak: 64, totalDaysObserved: 22, lastSeenAtMs: 0 };
  if (level === "L3") return { worstSevenDayPeak: 41, avgSevenDayAvg: 24, worstFiveHourPeak: 30, worstOpusPeak: 18, totalDaysObserved: 20, lastSeenAtMs: 0 };
  if (level === "L0") return { worstSevenDayPeak: 0, avgSevenDayAvg: 0, worstFiveHourPeak: 0, worstOpusPeak: 0, totalDaysObserved: 3, lastSeenAtMs: 0 };
  return { worstSevenDayPeak: 58, avgSevenDayAvg: 47, worstFiveHourPeak: 44, worstOpusPeak: 30, totalDaysObserved: 20, lastSeenAtMs: 0 };
}

export function buildMockGroupReport(members: MockRealMember[]): MockGroupData {
  const sorted = [...members].sort((a, b) => a.membershipId.localeCompare(b.membershipId));
  const assigned = sorted.map((m, i) => ({ ...m, level: LEVEL_CYCLE[i % LEVEL_CYCLE.length] }));
  const authorIdx = assigned.findIndex((m) => m.level === "L4");
  const adopterCount = authorIdx >= 0 && assigned[authorIdx + 1] ? 1 : 0;

  const portraits = assigned.map((m, i) => portrait(m.name, m.level, i === authorIdx, i === authorIdx ? adopterCount : 0));
  portraits.sort((a, b) => b.level.localeCompare(a.level));

  const distribution: Record<MaturityLevel, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const p of portraits) distribution[p.level] += 1;
  const classifications: MaturityMemberClassification[] = portraits.map((p) => ({ member: p.member, level: p.level, evidence: mixCue(p) }));

  const activeCount = assigned.filter((m) => m.level !== "L0").length;
  const agentHoursWk = assigned.reduce((s, m) => s + PROFILE[m.level].agentHoursWk, 0);
  const sessionsWk = assigned.reduce((s, m) => s + Math.round(PROFILE[m.level].sessions30 / 4), 0);
  const prsWk = assigned.reduce((s, m) => s + PROFILE[m.level].prsWk, 0);
  const planAdopters = assigned.filter((m) => PROFILE[m.level].planMode).length;

  const liveExtras: LiveExtras = {
    active_rate: { members_total: members.length, active_7d: activeCount, active_7d_prev: activeCount, active_30d: activeCount },
    maturity_mix: { distribution, classifications },
    prs_shipped: {
      current: prsWk, last_week: Math.max(0, prsWk - 2),
      per_active_engineer: activeCount ? Math.round((prsWk / activeCount) * 10) / 10 : 0,
      per_active_engineer_last_week: activeCount ? Math.round((Math.max(0, prsWk - 2) / activeCount) * 10) / 10 : 0,
    },
    plan_mode: {
      sessions: planAdopters * 3, sessions_last_week: planAdopters * 2,
      adopters: planAdopters, adoption_pct: activeCount ? Math.round((planAdopters / activeCount) * 100) : 0,
    },
    data_freshness: "mock",
    member_portraits: portraits,
    // Integration-backed blocks, shaped to demo well: a non-degenerate AI
    // split (unlike all-AI teams where the comparison collapses), bigger
    // cohorts taking visibly longer, and everything improving WoW.
    github_delivery: {
      repos: ["acme/web-app", "acme/platform-api"],
      last_sync_at: null,
      open_now: 4,
      week: {
        merged: 18, ai_assisted: 14, ai_share_pct: 78,
        median_cycle_hours_ai: 3.1, median_cycle_hours_other: 9.4,
        median_review_wait_hours_ai: 1.2, median_review_wait_hours_other: 2.5,
      },
      prev_week: {
        merged: 15, ai_assisted: 11, ai_share_pct: 73,
        median_cycle_hours_ai: 3.8, median_cycle_hours_other: 10.2,
        median_review_wait_hours_ai: 1.5, median_review_wait_hours_other: 2.9,
      },
    },
    linear_velocity: {
      team_keys: ["ENG"],
      last_sync_at: null,
      wip_now: 6,
      week: { completed: 11, ai_linked: 9, ai_linked_share_pct: 82, median_cycle_hours: 4.2, median_lead_hours: 74.4 },
      prev_week: { completed: 9, ai_linked: 6, ai_linked_share_pct: 67, median_cycle_hours: 6.8, median_lead_hours: 98.6 },
    },
    work_timeline: {
      tickets: 11,
      unjoined: 2,
      sized_by: "lines",
      queue_median_hours: 52.5,
      queue_median_hours_prev: 60.2,
      week: { build: { median_hours: 2.6, p90_hours: 7.4 }, review: { median_hours: 1.8, p90_hours: 12.5 } },
      prev_week: { build: { median_hours: 3.4, p90_hours: 9 }, review: { median_hours: 2.6, p90_hours: 18 } },
      size_classes: [
        { size: "S", bounds: "<1k lines", tickets: 5, build_hours: 1.2, review_hours: 0.9, total_hours: 2.3, prev_tickets: 4, prev_build_hours: 1.6, prev_review_hours: 1.4, prev_total_hours: 3.2 },
        { size: "M", bounds: "1–3k lines", tickets: 4, build_hours: 3.8, review_hours: 2.4, total_hours: 6.5, prev_tickets: 3, prev_build_hours: 4.6, prev_review_hours: 3.5, prev_total_hours: 8.4 },
        { size: "L", bounds: ">3k lines", tickets: 2, build_hours: 6.9, review_hours: 4.1, total_hours: 11.8, prev_tickets: 2, prev_build_hours: 8.2, prev_review_hours: 6.8, prev_total_hours: 15.3 },
      ],
    },
  };

  const report = structuredClone(mockTeamInsightReport) as TeamInsightReport;
  report.members_total = members.length;
  report.cross_edition.roster = assigned.map((m) => ({
    membership_id: m.membershipId, display_name: m.name,
    agent_hours: Math.round(PROFILE[m.level].agentHoursWk * 10) / 10,
    shipped: PROFILE[m.level].prsWk,
  }));
  report.volume.agent_hours_total = Math.round(agentHoursWk * 10) / 10;
  report.variants.wow_pulse.agent_hours.current = Math.round(agentHoursWk * 10) / 10;
  report.variants.wow_pulse.sessions.current = sessionsWk;
  // Two rows canonicalized onto the mock connected repos, two member-local —
  // demos both states of the per-project block's name handling.
  report.variants.wow_pulse.project_time = [
    { project: "acme/web-app", repo: "acme/web-app", hours_this_week: 8.2, hours_last_week: 6.4, delta_pct: 28 },
    { project: "acme/platform-api", repo: "acme/platform-api", hours_this_week: 5.1, hours_last_week: 4.9, delta_pct: 4 },
    { project: "ops-runbooks", hours_this_week: 3.4, hours_last_week: 4.2, delta_pct: -19 },
    { project: "infra-bootstrap", hours_this_week: 1.7, hours_last_week: 0.9, delta_pct: 89 },
  ];
  report.live_extras = liveExtras;

  // 4-week trend — a gentle upward trajectory ending at this week's totals.
  const trend: MomentumTrendWeek[] = [0.82, 0.9, 0.96, 1].map((f, i) => ({
    weekMonday: `wk-${i}`,
    agentHours: Math.round(agentHoursWk * f * 10) / 10,
    sessions: Math.round(sessionsWk * f),
    prs: Math.round(prsWk * f),
    activeMembers: activeCount,
  }));

  // Seat right-sizing — reuse the real optimizer on synthesized stats.
  const recs = assigned.map((m, i) => ({ m, rec: recommend(statsFor(m.level, i === authorIdx), tierEntry(m.tier)) }));
  const seatCandidates: SeatCandidate[] = recs
    .filter((r) => r.rec.action === "downgrade")
    .map((r) => {
      const rec = r.rec as Extract<typeof r.rec, { action: "downgrade" }>;
      const stats = statsFor(r.m.level, false);
      return {
        name: r.m.name,
        fromTier: tierEntry(r.m.tier).label,
        toTier: tierEntry(rec.targetTier as PlanTierKey).label,
        avgPct: Math.round(stats.avgSevenDayAvg),
        peakPct: Math.round(stats.worstSevenDayPeak),
        savingsUsd: rec.estimatedSavingsUsd,
      };
    });
  const seatReviewed = recs.filter((r) => r.rec.action !== "insufficient_data").length;
  const seatInsufficient = recs.filter((r) => r.rec.action === "insufficient_data").length;

  return {
    report, trend, seatCandidates, seatReviewed, seatInsufficient,
    membersTotal: members.length, activeCount,
  };
}
