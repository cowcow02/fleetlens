import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import {
  SectionFrame,
  Subhead,
  FactTile,
  FactGrid,
  FactRow,
  MiniBar,
  TextSparkline,
  SimpleTable,
  SensitiveCallout,
  NarrativeLine,
  ChipRow,
  MemberBarRow,
} from "../../../../components/insights-primitives";
import { SpotlightsSection } from "../../../../components/spotlight-card";
import { mockTeamInsightReport } from "./mock-data";

export const dynamic = "force-dynamic";

const SECTION_LIST: { letter: string; title: string }[] = [
  { letter: "A", title: "Volume / time / activity" },
  { letter: "B", title: "Code zones" },
  { letter: "C", title: "Working style" },
  { letter: "D", title: "Tool usage (no raw counts)" },
  { letter: "E", title: "Skills & harness" },
  { letter: "F", title: "Delegation / subagent patterns" },
  { letter: "G", title: "Plan mode" },
  { letter: "H", title: "Outcomes / shipping" },
  { letter: "I", title: "Friction / failure" },
  { letter: "J", title: "Diffusion" },
  { letter: "K", title: "Co-occurrence" },
  { letter: "L", title: "Team bench" },
  { letter: "M", title: "Novelty / invention" },
  { letter: "N", title: "External systems" },
  { letter: "O", title: "Prompting fingerprint" },
  { letter: "P", title: "Rhythm / time-of-day" },
  { letter: "Q", title: "Velocity" },
  { letter: "R", title: "Knowledge flow" },
  { letter: "S", title: "AI behavior" },
  { letter: "T", title: "Cost / efficiency" },
  { letter: "U", title: "Coverage / dead zones" },
  { letter: "V", title: "Trend (multi-week)" },
  { letter: "W", title: "Onboarding" },
  { letter: "X", title: "Manager affordances" },
  { letter: "Y", title: "Org roll-up" },
  { letter: "Z", title: "Pair work / threads" },
  { letter: "AA", title: "Outliers / surprises" },
  { letter: "BB", title: "Spotlights" },
  { letter: "CC", title: "Meta / dashboard self-signals" },
  { letter: "DD", title: "Cross-edition affordances" },
];

export default async function TeamInsightsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  const r = mockTeamInsightReport;
  const weekDate = new Date(`${r.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <>
      <div className="section-head">
        <div>
          <h1>The <em>Insight Report</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Week of {fmt(weekDate).toUpperCase()} — {fmt(weekEnd).toUpperCase()}
            {" · "}
            {r.cross_edition.roster.length} of {r.members_total} members active
            {" · "}
            {r.volume.agent_hours_total.toFixed(1)}h combined agent time
          </div>
        </div>
        <div className="kicker">Maximal prototype · 30 sections</div>
      </div>

      <nav className="insights-toc">
        <div className="insights-toc-label">Jump to section</div>
        <div className="insights-toc-links">
          {SECTION_LIST.map((s) => (
            <a key={s.letter} href={`#section-${s.letter}`}>
              <span className="mono">{s.letter}</span> {s.title}
            </a>
          ))}
        </div>
      </nav>

      <SensitiveCallout note="Items marked ⚠ are included so you can see the data we could surface, but each carries privacy / human-cost risk worth weighing. Tags are visible inline." />

      {/* ─── A. Volume / time / activity ─────────────────────────────── */}
      <SectionFrame letter="A" title={<>Volume / time / <em>activity</em></>} subtitle="Numeric pulse · agent fleet at a glance">
        <FactGrid cols={3}>
          <FactTile label="Combined agent time" value={<>{r.volume.agent_hours_total.toFixed(1)}<span className="pulse-tile-suffix">h</span></>} sub={`+${r.volume.agent_hours_wow_delta_pct}% vs last week`} />
          <FactTile label="Sessions" value={r.volume.sessions_total} sub={`Median session ${r.volume.median_session_min}min`} />
          <FactTile label="Concurrency peak" value={`${r.volume.concurrency_peak.peak}×`} sub={`on ${r.volume.concurrency_peak.date}`} />
          <FactTile label="Total turns" value={r.volume.total_turns} sub={`${r.volume.tools_per_turn.toFixed(1)} tools/turn`} />
          <FactTile label="Total tool calls" value={r.volume.total_tool_calls} />
          <FactTile label="Longest single session" value={`${r.volume.longest_session.hours.toFixed(1)}h`} sub={`${r.volume.longest_session.member} · ${r.volume.longest_session.project} · ${r.volume.longest_session.date}`} />
        </FactGrid>

        <Subhead>Agent hours per member</Subhead>
        <FactGrid cols={4}>
          {r.volume.agent_hours_per_member.map((m) => (
            <FactTile key={m.member} label={m.member} value={`${m.hours.toFixed(1)}h`} />
          ))}
        </FactGrid>

        <Subhead>Agent hours per project</Subhead>
        <MiniBar segments={r.volume.agent_hours_per_project.map((p) => ({ label: p.project, value: p.hours }))} />

        <Subhead>Agent hours per user-authored skill</Subhead>
        <MiniBar segments={r.volume.agent_hours_per_user_skill.map((s) => ({ label: s.skill, value: s.hours }))} />

        <Subhead>Session length histogram</Subhead>
        <MiniBar segments={r.volume.session_length_histogram.map((b) => ({ label: b.bucket, value: b.count }))} />

        <Subhead>Sessions per member</Subhead>
        <MiniBar segments={r.volume.sessions_per_member.map((m) => ({ label: m.member, value: m.count }))} />

        <Subhead>Tokens consumed</Subhead>
        <FactGrid cols={4}>
          <FactTile label="Input" value={r.volume.tokens.input.toLocaleString()} />
          <FactTile label="Output" value={r.volume.tokens.output.toLocaleString()} />
          <FactTile label="Cache read" value={r.volume.tokens.cache_read.toLocaleString()} />
          <FactTile label="Cache write" value={r.volume.tokens.cache_write.toLocaleString()} />
        </FactGrid>

        <Subhead>Cost</Subhead>
        <FactGrid cols={3}>
          <FactTile label="Total" value={`$${r.volume.cost_total_usd.toFixed(2)}`} />
          <FactTile label="Per member" value={<MiniBar segments={r.volume.cost_per_member.map((m) => ({ label: m.member, value: m.usd }))} />} span={1} />
          <FactTile label="Per project" value={<MiniBar segments={r.volume.cost_per_project.map((p) => ({ label: p.project, value: p.usd }))} />} span={1} />
        </FactGrid>

        <Subhead>Cost per shipped PR per member</Subhead>
        <SimpleTable
          headers={["⚠ Member", "$/PR"]}
          rows={r.volume.cost_per_shipped_pr_per_member.map((m) => [m.member, m.usd_per_pr ? `$${m.usd_per_pr.toFixed(2)}` : "—"])}
        />
      </SectionFrame>

      {/* ─── B. Code zones ────────────────────────────────────────────── */}
      <SectionFrame letter="B" title={<>Code <em>zones</em></>} subtitle="Where the agent fleet landed in the repo">
        <Subhead>File heatmap (top touched)</Subhead>
        <SimpleTable
          headers={["File path", "Touches", "Members"]}
          rows={r.code_zones.file_heatmap.map((f) => [<code key={f.path}>{f.path}</code>, f.touches, f.members])}
        />

        <Subhead>Multi-member files (collaboration zones)</Subhead>
        <SimpleTable
          headers={["File path", "Members"]}
          rows={r.code_zones.multi_member_files.map((f) => [<code key={f.path}>{f.path}</code>, f.members.join(" · ")])}
        />

        <Subhead>Silo files (only one member)</Subhead>
        <SimpleTable
          headers={["File path", "Member", "Touches"]}
          rows={r.code_zones.silo_files.map((f) => [<code key={f.path}>{f.path}</code>, f.member, f.touches])}
        />

        <Subhead>Cold directories (no agent activity)</Subhead>
        <SimpleTable
          headers={["Path", "Note"]}
          rows={r.code_zones.cold_directories.map((d) => [<code key={d.path}>{d.path}</code>, d.note])}
        />

        <Subhead>Most-rewritten files this week</Subhead>
        <SimpleTable
          headers={["File path", "Edits"]}
          rows={r.code_zones.most_rewritten_files.map((f) => [<code key={f.path}>{f.path}</code>, f.edits])}
        />

        <Subhead>File-type mix</Subhead>
        <MiniBar segments={r.code_zones.file_type_mix.map((t) => ({ label: t.ext, value: t.share_pct }))} />

        <Subhead>Languages</Subhead>
        <MiniBar segments={r.code_zones.languages.map((l) => ({ label: l.name, value: l.share_pct }))} />

        <FactGrid cols={4}>
          <FactTile label="New files originated" value={r.code_zones.new_files_originated} />
          <FactTile label="Modified files" value={r.code_zones.modified_files} />
          <FactTile label="Tests : code ratio" value={`${r.code_zones.tests_to_code_ratio_pct}%`} />
          <FactTile label="Docs : code ratio" value={`${r.code_zones.docs_to_code_ratio_pct}%`} />
          <FactTile label="Config : code ratio" value={`${r.code_zones.config_to_code_ratio_pct}%`} />
          <FactTile label="Shipped vs not (files)" value={`${r.code_zones.shipped_vs_nonshipped_files.shipped} / ${r.code_zones.shipped_vs_nonshipped_files.nonshipped}`} />
        </FactGrid>

        <Subhead>File-extension diversity per member</Subhead>
        <SimpleTable
          headers={["Member", "Distinct extensions"]}
          rows={r.code_zones.extension_diversity_per_member.map((m) => [m.member, m.extensions])}
        />
      </SectionFrame>

      {/* ─── C. Working style ─────────────────────────────────────────── */}
      <SectionFrame letter="C" title={<>Working <em>style</em></>} subtitle="Per-member characterization · never quoted">
        <Subhead>Prompt-length distribution per member</Subhead>
        {r.working_style.prompt_length_distribution_per_member.map((m) => (
          <MemberBarRow
            key={m.member}
            member={m.member}
            values={[
              { label: "short", value: m.short },
              { label: "medium", value: m.medium },
              { label: "long", value: m.long },
              { label: "very_long", value: m.very_long },
            ]}
          />
        ))}

        <Subhead>Long-brief ratio per member</Subhead>
        <SimpleTable
          headers={["Member", "Long briefs %"]}
          rows={r.working_style.long_brief_ratio_per_member.map((m) => [m.member, `${m.ratio_pct}%`])}
        />

        <Subhead>Verbosity drift week-over-week</Subhead>
        <SimpleTable
          headers={["Member", "Direction", "Δ %"]}
          rows={r.working_style.verbosity_drift_per_member.map((m) => [m.member, m.direction, `${m.delta_pct >= 0 ? "+" : ""}${m.delta_pct}%`])}
        />

        <Subhead>Imperative vs. conversational</Subhead>
        <SimpleTable
          headers={["Member", "Imperative %"]}
          rows={r.working_style.imperative_vs_conversational_per_member.map((m) => [m.member, `${m.imperative_pct}%`])}
        />

        <FactGrid cols={4}>
          {r.working_style.code_block_usage_per_member.map((m) => (
            <FactTile key={m.member} label={`${m.member} · code-block use`} value={`${m.pct}%`} />
          ))}
        </FactGrid>

        <Subhead>External-ref vs. self-contained prompts</Subhead>
        <SimpleTable
          headers={["Member", "External ref %"]}
          rows={r.working_style.external_ref_vs_self_contained_per_member.map((m) => [m.member, `${m.external_pct}%`])}
        />

        <Subhead>Structured-format usage</Subhead>
        <SimpleTable
          headers={["Member", "Structured prompt %"]}
          rows={r.working_style.structured_format_usage_per_member.map((m) => [m.member, `${m.pct}%`])}
        />

        <Subhead>Interrupts + frustrated signals</Subhead>
        <SimpleTable
          headers={["Member", "Interrupts/session", "Frustrated signals"]}
          rows={r.working_style.interrupt_freq_per_member.map((m) => {
            const f = r.working_style.frustrated_signals_per_member.find((x) => x.member === m.member);
            return [m.member, m.per_session.toFixed(1), f?.count ?? 0];
          })}
        />

        <SensitiveCallout note="The four items below are tone / politeness / sentiment grading. Each is mineable but voyeuristic — strongly consider whether surfacing these adds value." />
        <Subhead>⚠ Tone grade per member</Subhead>
        <SimpleTable
          headers={["⚠ Member", "Grade"]}
          rows={r.working_style.tone_grade_per_member.map((m) => [m.member, m.grade])}
        />
        <Subhead>⚠ Politeness markers per member message</Subhead>
        <SimpleTable
          headers={["⚠ Member", "Per message"]}
          rows={r.working_style.politeness_markers_per_member.map((m) => [m.member, m.per_msg.toFixed(2)])}
        />
        <Subhead>⚠ Sentiment of user messages</Subhead>
        <SimpleTable
          headers={["⚠ Member", "Positive %", "Neutral %", "Negative %"]}
          rows={r.working_style.sentiment_user_messages_per_member.map((m) => [m.member, m.positive, m.neutral, m.negative])}
        />
        <Subhead>⚠ Sentiment of agent responses (team aggregate)</Subhead>
        <MiniBar segments={[
          { label: "positive", value: r.working_style.sentiment_agent_responses.positive },
          { label: "neutral", value: r.working_style.sentiment_agent_responses.neutral },
          { label: "negative", value: r.working_style.sentiment_agent_responses.negative },
        ]} />
      </SectionFrame>

      {/* ─── D. Tool usage ────────────────────────────────────────────── */}
      <SectionFrame letter="D" title={<>Tool <em>usage</em></>} subtitle="Raw tool-family counts skipped per earlier feedback">
        <Subhead>Bash sub-verb heatmap (what infra commands fire)</Subhead>
        <MiniBar segments={r.tool_usage.bash_subverb_heatmap.map((b) => ({ label: b.subverb, value: b.count }))} />

        <FactGrid cols={3}>
          <FactTile label="Read : Edit ratio" value={r.tool_usage.read_edit_ratio.toFixed(2)} />
          <FactTile label="WebFetch / WebSearch" value={r.tool_usage.webfetch_websearch_count} />
          <FactTile label="TodoWrite ops per session" value={r.tool_usage.todowrite_ops_per_session_avg.toFixed(1)} />
          <FactTile label="Tool retry chains" value={r.tool_usage.tool_retry_chains_count} />
          <FactTile label="Avg tools per turn" value={r.tool_usage.avg_tools_per_turn.toFixed(1)} />
        </FactGrid>

        <Subhead>Tool error rate per member</Subhead>
        <SimpleTable
          headers={["Member", "Error rate %"]}
          rows={r.tool_usage.tool_error_rate_per_member.map((m) => [m.member, `${m.rate_pct.toFixed(1)}%`])}
        />
      </SectionFrame>

      {/* ─── E. Skills & harness ──────────────────────────────────────── */}
      <SectionFrame letter="E" title={<>Skills & <em>harness</em></>} subtitle="What the team built around the agent fleet">
        <Subhead>User-authored skills</Subhead>
        <SimpleTable
          headers={["Skill", "Originated by", "Adopters", "Uses"]}
          rows={r.skills_harness.user_authored_skills.map((s) => [<code key={s.name}>{s.name}</code>, s.originated_by, s.adopters, s.uses])}
        />

        <Subhead>User-authored subagents</Subhead>
        <SimpleTable
          headers={["Subagent", "Originated by", "Adopters", "Uses"]}
          rows={r.skills_harness.user_authored_subagents.map((s) => [<code key={s.name}>{s.name}</code>, s.originated_by, s.adopters, s.uses])}
        />

        <Subhead>Skill families (prefix groupings)</Subhead>
        <SimpleTable
          headers={["Family", "Members", "Uses"]}
          rows={r.skills_harness.skill_families.map((s) => [<code key={s.family}>{s.family}</code>, s.members, s.uses])}
        />

        <Subhead>Newly authored this week</Subhead>
        {r.skills_harness.skills_newly_authored_this_week.map((s) => (
          <NarrativeLine key={s.name}>
            <code>{s.name}</code> · authored by {s.author} on {s.date}
          </NarrativeLine>
        ))}

        <Subhead>Skill diffusion events (cross-member pickups)</Subhead>
        {r.skills_harness.skill_diffusion_events.map((e, i) => (
          <NarrativeLine key={i}>
            <code>{e.skill}</code> · {e.from_member} → {e.to_member} on {e.date}
          </NarrativeLine>
        ))}

        <Subhead>Skills abandoned this week</Subhead>
        {r.skills_harness.skills_abandoned_this_week.map((s) => (
          <NarrativeLine key={s.name}>
            <code>{s.name}</code> · previously {s.prev_uses} uses → {s.current_uses} this week
          </NarrativeLine>
        ))}

        <Subhead>Pre-flight skill loads (loaded before any tool call)</Subhead>
        <SimpleTable
          headers={["Skill", "Sessions"]}
          rows={r.skills_harness.preflight_skill_loads.map((s) => [<code key={s.skill}>{s.skill}</code>, s.sessions])}
        />

        <Subhead>Mid-session skill loads (corrective)</Subhead>
        <SimpleTable
          headers={["Skill", "Sessions"]}
          rows={r.skills_harness.midsession_skill_loads.map((s) => [<code key={s.skill}>{s.skill}</code>, s.sessions])}
        />

        <Subhead>Skills loaded but never dispatched</Subhead>
        <SimpleTable
          headers={["Skill", "Loads"]}
          rows={r.skills_harness.skills_loaded_never_dispatched.map((s) => [<code key={s.name}>{s.name}</code>, s.loads])}
        />

        <FactGrid cols={2}>
          <FactTile label="Sessions with zero skills loaded" value={r.skills_harness.sessions_with_zero_skills} />
          <FactTile label="Skill descriptions updated mid-week" value={r.skills_harness.skill_descriptions_updated_midweek.length} sub={r.skills_harness.skill_descriptions_updated_midweek.map((u) => `${u.skill} · ${u.member}`).join(" · ")} />
        </FactGrid>

        <Subhead>Stock vs. user-skill ratio per member</Subhead>
        <SimpleTable
          headers={["Member", "Stock %"]}
          rows={r.skills_harness.stock_vs_user_ratio_per_member.map((m) => [m.member, `${m.stock_pct}%`])}
        />

        <Subhead>Slash-commands used</Subhead>
        <SimpleTable
          headers={["Command", "Uses", "Users"]}
          rows={r.skills_harness.slash_commands_used.map((s) => [<code key={s.command}>{s.command}</code>, s.uses, s.users])}
        />
      </SectionFrame>

      {/* ─── F. Delegation ────────────────────────────────────────────── */}
      <SectionFrame letter="F" title={<>Delegation / <em>subagent patterns</em></>}>
        <Subhead>Subagent dispatches per member</Subhead>
        <MiniBar segments={r.delegation.subagent_dispatches_per_member.map((m) => ({ label: m.member, value: m.count }))} />

        <FactGrid cols={3}>
          <FactTile label="Parallel batches" value={r.delegation.parallel_vs_sequential_batches.parallel} />
          <FactTile label="Sequential batches" value={r.delegation.parallel_vs_sequential_batches.sequential} />
          <FactTile label="Background runs" value={r.delegation.background_runs} />
          <FactTile label="Avg subagent prompt chars" value={r.delegation.avg_subagent_prompt_chars} />
          <FactTile label="Reviewer-triad sessions" value={r.delegation.reviewer_triad_sessions} />
          <FactTile label="Implementer + reviewer pairs" value={r.delegation.implementer_reviewer_pairs} />
          <FactTile label="Orchestration-brief-first sessions" value={r.delegation.orchestration_brief_first_sessions} />
          <FactTile label="Subagent shipping rate" value={`${r.delegation.subagent_shipping_rate_pct}%`} />
        </FactGrid>

        <Subhead>Subagent types invoked</Subhead>
        <SimpleTable
          headers={["Type", "Count"]}
          rows={r.delegation.subagent_types_invoked.map((s) => [<code key={s.type}>{s.type}</code>, s.count])}
        />

        <Subhead>User-authored vs. stock subagent ratio per member</Subhead>
        <SimpleTable
          headers={["Member", "User-authored %"]}
          rows={r.delegation.user_authored_vs_stock_per_member.map((m) => [m.member, `${m.user_pct}%`])}
        />

        <Subhead>Solo vs. orchestrated sessions per member</Subhead>
        <SimpleTable
          headers={["Member", "Orchestrated %"]}
          rows={r.delegation.solo_vs_orchestrated_per_member.map((m) => [m.member, `${m.orchestrated_pct}%`])}
        />
      </SectionFrame>

      {/* ─── G. Plan mode ─────────────────────────────────────────────── */}
      <SectionFrame letter="G" title={<>Plan <em>mode</em></>}>
        <FactGrid cols={3}>
          <FactTile label="Plan-mode adopters" value={`${r.plan_mode.adopters} of ${r.members_total}`} />
          <FactTile label="Brainstorm-warmup adopters" value={r.plan_mode.brainstorm_warmup_adopters} />
          <FactTile label="Plan-then-build : dive-in" value={r.plan_mode.plan_then_build_vs_dive_in_ratio.toFixed(2)} />
          <FactTile label="Avg plan duration" value={`${r.plan_mode.avg_plan_duration_min.toFixed(1)} min`} />
          <FactTile label="Plans shipped" value={r.plan_mode.plans_shipped} />
          <FactTile label="Plans abandoned" value={r.plan_mode.plans_abandoned} />
          <FactTile label="Longest discipline streak" value={`${r.plan_mode.longest_discipline_streak_days} days`} />
          <FactTile label="Warmup-ritual sessions" value={r.plan_mode.warmup_ritual_sessions} />
        </FactGrid>
      </SectionFrame>

      {/* ─── H. Outcomes ──────────────────────────────────────────────── */}
      <SectionFrame letter="H" title={<>Outcomes / <em>shipping</em></>}>
        <FactGrid cols={3}>
          <FactTile label="PRs shipped" value={r.outcomes.prs_shipped} />
          <FactTile label="Sessions ending in commit" value={r.outcomes.sessions_ending_in_commit} />
          <FactTile label="Sessions ending in PR" value={r.outcomes.sessions_ending_in_pr} />
        </FactGrid>

        <Subhead>PRs per member</Subhead>
        <MiniBar segments={r.outcomes.prs_per_member.map((m) => ({ label: m.member, value: m.count }))} />

        <Subhead>PRs per project</Subhead>
        <MiniBar segments={r.outcomes.prs_per_project.map((p) => ({ label: p.project, value: p.count }))} />

        <Subhead>Median first-user → merge per member</Subhead>
        <SimpleTable
          headers={["Member", "Minutes"]}
          rows={r.outcomes.median_first_user_to_merge_min_per_member.map((m) => [m.member, m.minutes || "—"])}
        />

        <Subhead>Per-project outcome</Subhead>
        <SimpleTable
          headers={["Project", "Shipped", "Partial", "Blocked"]}
          rows={r.outcomes.per_project_outcome.map((p) => [p.project, p.shipped, p.partial, p.blocked])}
        />

        <Subhead>Skill ↔ ship-rate correlation</Subhead>
        <SimpleTable
          headers={["Skill", "Ship rate %"]}
          rows={r.outcomes.skill_ship_rate.map((s) => [<code key={s.skill}>{s.skill}</code>, `${s.ship_rate_pct}%`])}
        />

        <Subhead>Subagent ↔ ship-rate correlation</Subhead>
        <SimpleTable
          headers={["Subagent", "Ship rate %"]}
          rows={r.outcomes.subagent_ship_rate.map((s) => [<code key={s.subagent}>{s.subagent}</code>, `${s.ship_rate_pct}%`])}
        />

        <Subhead>Ship rate by time-of-day</Subhead>
        <MiniBar segments={r.outcomes.time_of_day_ship_rate.map((h) => ({ label: `${h.hour}:00`, value: h.ship_rate_pct }))} />

        <Subhead>⚠ Shipping-rate ranking per member</Subhead>
        <SimpleTable
          headers={["⚠ Member", "Ship rate %"]}
          rows={r.outcomes.shipping_rate_ranking.map((m) => [m.member, `${m.ship_rate_pct}%`])}
        />
      </SectionFrame>

      {/* ─── I. Friction ──────────────────────────────────────────────── */}
      <SectionFrame letter="I" title={<>Friction / <em>failure</em></>}>
        <Subhead>Co-occurring friction kinds (team-only signal)</Subhead>
        {r.friction.cooccurring_friction.map((c) => (
          <div key={c.kind} className="narrative-card">
            <div className="narrative-card-head">
              <strong>{c.kind}</strong> · {c.members_affected.join(" + ")}
            </div>
            <div className="narrative-card-body">{c.description}</div>
          </div>
        ))}

        <FactGrid cols={3}>
          <FactTile label="Frustrated sessions" value={r.friction.frustrated_sessions} />
          <FactTile label="Multi-interrupt sessions" value={r.friction.multi_interrupt_sessions} />
          <FactTile label="Abandoned sessions" value={r.friction.abandoned_sessions} />
          <FactTile label="Loops detected" value={r.friction.loops_detected} />
          <FactTile label="Long-autonomous failures" value={r.friction.long_autonomous_failures} />
          <FactTile label="Retry-same-op count" value={r.friction.retry_same_op_count} />
        </FactGrid>

        <Subhead>Shared error messages</Subhead>
        <SimpleTable
          headers={["Error", "Members"]}
          rows={r.friction.shared_errors.map((e) => [<code key={e.error}>{e.error}</code>, e.members_affected.join(", ")])}
        />

        <Subhead>Shared dependencies causing trouble</Subhead>
        <SimpleTable
          headers={["Dependency", "Members"]}
          rows={r.friction.shared_dependency_trouble.map((d) => [<code key={d.dep}>{d.dep}</code>, d.members.join(", ")])}
        />

        <Subhead>Shared external systems in frustrated sessions</Subhead>
        <SimpleTable
          headers={["System", "Refs"]}
          rows={r.friction.shared_external_systems_frustrated.map((s) => [s.system, s.refs.join(", ")])}
        />

        <Subhead>⚠ Friction rate per member</Subhead>
        <SimpleTable
          headers={["⚠ Member", "Friction rate %"]}
          rows={r.friction.friction_rate_per_member.map((m) => [m.member, `${m.rate_pct}%`])}
        />

        <Subhead>Session-recovery moves (how stalls got resolved)</Subhead>
        {r.friction.recovery_moves.map((m, i) => (
          <NarrativeLine key={i}>
            <strong>{m.member}</strong> · {m.date} — {m.description}
          </NarrativeLine>
        ))}
      </SectionFrame>

      {/* ─── J. Diffusion ─────────────────────────────────────────────── */}
      <SectionFrame letter="J" title={<>Diffusion <em>across the team</em></>} subtitle="The genuinely team-only signal — what's spreading">
        <Subhead>Skill pickups this week (A → B)</Subhead>
        {r.diffusion.skill_pickups.map((p, i) => (
          <NarrativeLine key={i}>
            <code>{p.skill}</code> · {p.from_member} → {p.to_member} ({p.days_to_pickup} days)
          </NarrativeLine>
        ))}

        <Subhead>Subagent spread (current vs. weeks ago)</Subhead>
        <SimpleTable
          headers={["Type", "Then", "Now"]}
          rows={r.diffusion.subagent_spread.map((s) => [<code key={s.type}>{s.type}</code>, `${s.users_then} users, ${s.weeks_ago}w ago`, `${s.users_now} users`])}
        />

        <Subhead>Skill-family adoption curve (4 weeks)</Subhead>
        {r.diffusion.skill_family_curve.map((f) => (
          <FactRow
            key={f.family}
            label={<code>{f.family}</code>}
            value={<TextSparkline values={f.weekly} />}
            sub={`weekly user count: ${f.weekly.join(" → ")}`}
          />
        ))}

        <Subhead>Plan-mode adoption curve (4 weeks)</Subhead>
        <FactRow label="Plan-mode adopters" value={<TextSparkline values={r.diffusion.plan_mode_curve} />} sub={r.diffusion.plan_mode_curve.join(" → ")} />

        <Subhead>Brainstorm-warmup adoption curve</Subhead>
        <FactRow label="Brainstorm-warmup adopters" value={<TextSparkline values={r.diffusion.brainstorm_warmup_curve} />} sub={r.diffusion.brainstorm_warmup_curve.join(" → ")} />

        <Subhead>Prompt-pattern diffusion</Subhead>
        {r.diffusion.prompt_pattern_diffusion.map((p, i) => (
          <NarrativeLine key={i}>
            <em>“{p.pattern}”</em> · first seen by {p.first_seen_by} → spread to {p.spread_to.join(", ")}
          </NarrativeLine>
        ))}

        <Subhead>Tool-pattern spreading</Subhead>
        {r.diffusion.tool_pattern_spreading.map((p, i) => (
          <NarrativeLine key={i}>
            <em>{p.pattern}</em> · adopters: {p.adopters.join(", ")}
          </NarrativeLine>
        ))}

        <Subhead>Reverse diffusion (practices being abandoned)</Subhead>
        <SimpleTable
          headers={["Practice", "Peak count", "Current"]}
          rows={r.diffusion.reverse_diffusion.map((d) => [d.practice, d.peak_count, d.current_count])}
        />

        <Subhead>First-time-a-member-used-another's-skill events</Subhead>
        {r.diffusion.first_used_other_member_skill_events.map((e, i) => (
          <NarrativeLine key={i}>
            {e.event_member} used <code>{e.skill}</code> (originated by {e.original_author}) on {e.date}
          </NarrativeLine>
        ))}

        <NarrativeLine>{r.diffusion.velocity_diffusion_note}</NarrativeLine>

        <Subhead>Skill-authoring rate trend</Subhead>
        <FactRow label="Skills authored per week" value={<TextSparkline values={r.diffusion.skill_authoring_rate_trend} />} sub={r.diffusion.skill_authoring_rate_trend.join(" → ")} />
      </SectionFrame>

      {/* ─── K. Co-occurrence ─────────────────────────────────────────── */}
      <SectionFrame letter="K" title={<>Co-<em>occurrence</em></>} subtitle="Multi-member same-week signals">
        <Subhead>Shared friction kinds</Subhead>
        {r.cooccurrence.shared_friction_kinds.map((s, i) => (
          <NarrativeLine key={i}>
            <strong>{s.kind}</strong> · {s.members.join(", ")}
          </NarrativeLine>
        ))}

        <Subhead>Shared files (same week)</Subhead>
        <SimpleTable
          headers={["File", "Members"]}
          rows={r.cooccurrence.shared_files_same_week.map((s) => [<code key={s.path}>{s.path}</code>, s.members.join(" · ")])}
        />

        <Subhead>Shared external refs</Subhead>
        <SimpleTable
          headers={["Ref", "Members"]}
          rows={r.cooccurrence.shared_external_refs.map((s) => [<code key={s.ref}>{s.ref}</code>, s.members.join(" · ")])}
        />

        <Subhead>Shared skills (same day)</Subhead>
        <SimpleTable
          headers={["Skill", "Date", "Members"]}
          rows={r.cooccurrence.shared_skills_same_day.map((s) => [<code key={s.skill + s.date}>{s.skill}</code>, s.date, s.members.join(" · ")])}
        />

        <Subhead>Concurrent overlapping sessions</Subhead>
        <SimpleTable
          headers={["Date", "Window", "Members"]}
          rows={r.cooccurrence.concurrent_sessions.map((s, i) => [s.date, s.window, <ChipRow key={i} items={s.members} />])}
        />

        <Subhead>Shared debugging targets</Subhead>
        <SimpleTable
          headers={["Dependency", "Members"]}
          rows={r.cooccurrence.shared_debugging.map((s) => [<code key={s.dep}>{s.dep}</code>, s.members.join(" · ")])}
        />

        <Subhead>Shared subagent dispatch kinds</Subhead>
        <SimpleTable
          headers={["Subagent type", "Members"]}
          rows={r.cooccurrence.shared_subagent_dispatch_kinds.map((s) => [<code key={s.type}>{s.type}</code>, s.members.join(" · ")])}
        />
      </SectionFrame>

      {/* ─── L. Team bench ───────────────────────────────────────────── */}
      <SectionFrame letter="L" title={<>Team <em>bench</em></>} subtitle="“Ask X about Y” — who's ahead on what">
        <Subhead>Task-category bench</Subhead>
        <SimpleTable
          headers={["Category", "Bench member", "Metric"]}
          rows={r.bench.task_category_bench.map((b) => [b.category, <strong key={b.member}>{b.member}</strong>, b.metric_label])}
        />

        <FactGrid cols={3}>
          <FactTile label="Highest delegation rate" value={r.bench.highest_delegation_rate.member} sub={`${r.bench.highest_delegation_rate.dispatches_per_session.toFixed(2)} dispatches/session`} />
          <FactTile label="Highest skill-load rate" value={r.bench.highest_skill_load_rate.member} sub={`${r.bench.highest_skill_load_rate.loads_per_session.toFixed(2)} loads/session`} />
          <FactTile label="Most disciplined plan-mode user" value={r.bench.most_disciplined_plan_mode_user.member} sub={`${r.bench.most_disciplined_plan_mode_user.days} days`} />
          <FactTile label="Most parallel-dispatch user" value={r.bench.most_parallel_dispatch_user.member} sub={`${r.bench.most_parallel_dispatch_user.sessions} sessions`} />
          <FactTile label="Longest autonomous tolerance" value={r.bench.longest_autonomous_tolerance.member} sub={`${r.bench.longest_autonomous_tolerance.hours.toFixed(1)}h`} />
          <FactTile label="Highest first-pass ship rate" value={r.bench.highest_first_pass_ship_rate.member} sub={`${r.bench.highest_first_pass_ship_rate.pct}%`} />
          <FactTile label="Most diverse project portfolio" value={r.bench.most_diverse_project_portfolio.member} sub={`${r.bench.most_diverse_project_portfolio.projects} projects`} />
          <FactTile label="Highest user-authored skill output" value={r.bench.highest_user_authored_skill_output.member} sub={`${r.bench.highest_user_authored_skill_output.skills_authored} authored`} />
          <FactTile label="Most efficient" value={r.bench.most_efficient_member.member} sub={r.bench.most_efficient_member.metric} sensitive />
        </FactGrid>
      </SectionFrame>

      {/* ─── M. Novelty ───────────────────────────────────────────────── */}
      <SectionFrame letter="M" title={<>Novelty / <em>invention</em></>} subtitle="The week's discoveries">
        <div className="invention-card">
          <div className="invention-card-label">The week's invention</div>
          <h3 className="invention-card-title">{r.novelty.weeks_invention.headline}</h3>
          <div className="invention-card-meta">
            {r.novelty.weeks_invention.member} · {r.novelty.weeks_invention.session_date} · {r.novelty.weeks_invention.project}
          </div>
          <p className="invention-card-body">{r.novelty.weeks_invention.detail}</p>
        </div>

        <Subhead>First use of stock skill on the team</Subhead>
        {r.novelty.first_use_of_stock_skill.map((e, i) => (
          <NarrativeLine key={i}>
            <code>{e.skill}</code> · first used by {e.member} on {e.date}
          </NarrativeLine>
        ))}

        <Subhead>Other firsts</Subhead>
        <NarrativeLine>First successful parallel dispatch — {r.novelty.first_successful_parallel_dispatch.member} on {r.novelty.first_successful_parallel_dispatch.date}</NarrativeLine>
        <NarrativeLine>First long-autonomous turn that shipped — {r.novelty.first_long_autonomous_ship.member} on {r.novelty.first_long_autonomous_ship.date} ({r.novelty.first_long_autonomous_ship.hours.toFixed(1)}h)</NarrativeLine>

        <Subhead>First-time members used another member's skill</Subhead>
        {r.novelty.first_used_other_member_skill.map((e, i) => (
          <NarrativeLine key={i}>
            {e.event_member} used <code>{e.skill}</code> (originated by {e.original_author})
          </NarrativeLine>
        ))}

        <NarrativeLine>{r.novelty.unprecedented_move}</NarrativeLine>

        <Subhead>New CLAUDE.md additions</Subhead>
        {r.novelty.new_claudemd_additions.map((a, i) => (
          <NarrativeLine key={i}>
            <strong>{a.member}</strong> · {a.trigger_date} — {a.summary}
          </NarrativeLine>
        ))}

        <Subhead>New projects introduced</Subhead>
        {r.novelty.new_project_introduced.map((p, i) => (
          <NarrativeLine key={i}>
            <code>{p.project}</code> · {p.member} · {p.date}
          </NarrativeLine>
        ))}
      </SectionFrame>

      {/* ─── N. External systems ──────────────────────────────────────── */}
      <SectionFrame letter="N" title={<>External <em>systems</em></>}>
        <Subhead>Linear refs</Subhead>
        <SimpleTable
          headers={["Ref", "Member", "Sessions"]}
          rows={r.external_systems.linear_refs.map((l) => [<code key={l.ref}>{l.ref}</code>, l.member, l.sessions])}
        />

        <Subhead>GitHub refs</Subhead>
        <SimpleTable
          headers={["Ref", "Member", "Sessions"]}
          rows={r.external_systems.github_refs.map((g) => [<code key={g.ref}>{g.ref}</code>, g.member, g.sessions])}
        />

        <Subhead>Branch refs</Subhead>
        <SimpleTable
          headers={["Branch", "Sessions"]}
          rows={r.external_systems.branch_refs.map((b) => [<code key={b.branch}>{b.branch}</code>, b.sessions])}
        />

        <FactGrid cols={3}>
          <FactTile label="URL refs in prompts" value={r.external_systems.url_refs_count} />
          <FactTile label="Externally triggered sessions" value={r.external_systems.external_triggered_sessions} />
          <FactTile label="Sessions ending with PR post" value={r.external_systems.sessions_ending_with_pr_post} />
          <FactTile label="Most-leaned-on system" value={r.external_systems.most_leaned_on_system.system} sub={`${r.external_systems.most_leaned_on_system.refs} refs`} />
        </FactGrid>
      </SectionFrame>

      {/* ─── O. Prompting fingerprint ─────────────────────────────────── */}
      <SectionFrame letter="O" title={<>Prompting <em>fingerprint</em></>} subtitle="Per-member style, never quoted">
        <Subhead>Style descriptor per member</Subhead>
        <SimpleTable
          headers={["Member", "Style", "Descriptor"]}
          rows={r.prompting_fingerprint.style_per_member.map((s) => [s.member, <strong key={s.style}>{s.style}</strong>, s.descriptor])}
        />

        <Subhead>Prompt frame mix per member</Subhead>
        {r.prompting_fingerprint.prompt_frame_mix_per_member.map((m) => (
          <MemberBarRow
            key={m.member}
            member={m.member}
            values={[
              { label: "teammate", value: m.teammate },
              { label: "slash", value: m.slash_command },
              { label: "image", value: m.image_attached },
              { label: "handoff", value: m.handoff_prose },
            ]}
          />
        ))}

        <Subhead>First-user length histogram</Subhead>
        <MiniBar segments={r.prompting_fingerprint.first_user_length_histogram.map((b) => ({ label: b.bucket, value: b.count }))} />
      </SectionFrame>

      {/* ─── P. Rhythm ────────────────────────────────────────────────── */}
      <SectionFrame letter="P" title={<>Rhythm / <em>time-of-day</em></>}>
        <Subhead>Team hour-of-day histogram (24)</Subhead>
        <FactRow label="Hour 0 → 23" value={<TextSparkline values={r.rhythm.team_hour_histogram} />} />

        <Subhead>Per-member hour-of-day</Subhead>
        {r.rhythm.per_member_hour_histogram.map((m) => (
          <FactRow key={m.member} label={m.member} value={<TextSparkline values={m.histogram} />} />
        ))}

        <Subhead>Weekday histogram</Subhead>
        <MiniBar segments={r.rhythm.weekday_histogram.map((d) => ({ label: d.weekday, value: d.count }))} />

        <FactGrid cols={3}>
          <FactTile label="Peak hours" value={r.rhythm.peak_hours.map((h) => `${h}:00`).join(", ")} />
          <FactTile label="Burndown shape" value={r.rhythm.burndown_shape} />
          <FactTile label="Multi-TZ signal" value={r.rhythm.multi_timezone_signal} />
        </FactGrid>

        <SensitiveCallout note="The three items below — late-night, weekend, burnout-proxy — touch wellbeing. The data exists, but surfacing it to managers is a real intervention; weigh carefully." />
        <Subhead>⚠ Late-night sessions per member</Subhead>
        <SimpleTable
          headers={["⚠ Member", "Sessions after 22:00"]}
          rows={r.rhythm.late_night_sessions.map((m) => [m.member, m.count])}
        />
        <Subhead>⚠ Weekend sessions per member</Subhead>
        <SimpleTable
          headers={["⚠ Member", "Sat/Sun sessions"]}
          rows={r.rhythm.weekend_sessions.map((m) => [m.member, m.count])}
        />
        <Subhead>⚠ Burnout proxy</Subhead>
        {r.rhythm.burnout_proxy.map((b, i) => (
          <NarrativeLine key={i} sensitive>
            <strong>{b.member}</strong> · {b.signal}
          </NarrativeLine>
        ))}
      </SectionFrame>

      {/* ─── Q. Velocity ──────────────────────────────────────────────── */}
      <SectionFrame letter="Q" title={<>Velocity / <em>cadence</em></>}>
        <Subhead>Median first-user → commit per member</Subhead>
        <SimpleTable
          headers={["Member", "Minutes"]}
          rows={r.velocity.median_first_user_to_commit_per_member.map((m) => [m.member, m.minutes || "—"])}
        />

        <Subhead>Median first-user → PR per member</Subhead>
        <SimpleTable
          headers={["Member", "Minutes"]}
          rows={r.velocity.median_first_user_to_pr_per_member.map((m) => [m.member, m.minutes || "—"])}
        />

        <FactTile label="Median first-user → merge (team)" value={`${r.velocity.median_first_user_to_merge_min} min`} />

        <Subhead>Active-vs-wall-clock sample (top sessions)</Subhead>
        <SimpleTable
          headers={["Session", "Project", "Active %"]}
          rows={r.velocity.active_vs_wall_clock_ratio_sample.map((s) => [<code key={s.session_id}>{s.session_id}</code>, s.project, `${s.ratio_pct}%`])}
        />

        <Subhead>Sessions per day</Subhead>
        <MiniBar segments={r.velocity.sessions_per_day.map((d) => ({ label: d.date.slice(5), value: d.count }))} />

        <Subhead>PRs per week trend (4w)</Subhead>
        <FactRow label="PRs/week" value={<TextSparkline values={r.velocity.prs_per_week_trend} />} sub={r.velocity.prs_per_week_trend.join(" → ")} />

        <Subhead>Velocity per project (4w)</Subhead>
        {r.velocity.velocity_per_project_trend.map((p) => (
          <FactRow key={p.project} label={<code>{p.project}</code>} value={<TextSparkline values={p.weekly} />} sub={p.weekly.join(" → ")} />
        ))}
      </SectionFrame>

      {/* ─── R. Knowledge flow ───────────────────────────────────────── */}
      <SectionFrame letter="R" title={<>Knowledge <em>flow</em></>} subtitle="Patterns propagating across people, sessions, threads">
        <Subhead>Pattern A → B (one member to another)</Subhead>
        {r.knowledge_flow.pattern_a_to_b.map((p, i) => (
          <NarrativeLine key={i}>
            <em>“{p.pattern}”</em> · {p.member_a} ({p.date_a}) → {p.member_b} ({p.date_b})
          </NarrativeLine>
        ))}

        <Subhead>Pattern from main session → subagent brief</Subhead>
        {r.knowledge_flow.pattern_main_to_subagent.map((p, i) => (
          <NarrativeLine key={i}>
            <em>{p.pattern}</em> · {p.session_label}
          </NarrativeLine>
        ))}

        <Subhead>Pattern → CLAUDE.md addition</Subhead>
        {r.knowledge_flow.pattern_to_claudemd.map((p, i) => (
          <NarrativeLine key={i}>
            <em>“{p.pattern}”</em> · added by {p.member} on {p.addition_date}
          </NarrativeLine>
        ))}

        <Subhead>Skill refined after a session</Subhead>
        {r.knowledge_flow.skill_refined_after_session.map((s, i) => (
          <NarrativeLine key={i}>
            <code>{s.skill}</code> · {s.member} — {s.refinement}
          </NarrativeLine>
        ))}

        <Subhead>Multi-day threads</Subhead>
        <SimpleTable
          headers={["Thread", "Member", "Days", "Sessions"]}
          rows={r.knowledge_flow.multi_day_threads.map((t) => [t.thread_id, t.member, t.days, t.sessions])}
        />

        <Subhead>Handoff-prose events (cross-session context)</Subhead>
        <SimpleTable
          headers={["Member", "From session", "To session", "Date"]}
          rows={r.knowledge_flow.handoff_prose_events.map((h) => [h.member, h.from_session, h.to_session, h.date])}
        />

        <Subhead>Cross-member threads</Subhead>
        <SimpleTable
          headers={["Topic", "Members", "Sessions"]}
          rows={r.knowledge_flow.cross_member_threads.map((t) => [t.topic, t.members.join(" · "), t.sessions])}
        />
      </SectionFrame>

      {/* ─── S. AI behavior ──────────────────────────────────────────── */}
      <SectionFrame letter="S" title={<>AI <em>behavior</em></>} subtitle="What Claude itself did this week">
        <Subhead>Model usage</Subhead>
        <MiniBar segments={r.ai_behavior.model_usage.map((m) => ({ label: m.model, value: m.share_pct }))} />

        <FactGrid cols={3}>
          <FactTile label="Avg model mix · Opus" value={`${(r.ai_behavior.model_mix_per_session_avg.opus * 100).toFixed(0)}%`} />
          <FactTile label="Avg model mix · Sonnet" value={`${(r.ai_behavior.model_mix_per_session_avg.sonnet * 100).toFixed(0)}%`} />
          <FactTile label="Avg model mix · Haiku" value={`${(r.ai_behavior.model_mix_per_session_avg.haiku * 100).toFixed(0)}%`} />
          <FactTile label="Model fallback events" value={r.ai_behavior.model_fallback_events} />
          <FactTile label="Extended-thinking rate" value={`${r.ai_behavior.extended_thinking_rate_pct}%`} />
          <FactTile label="High-clarification sessions" value={r.ai_behavior.high_clarification_sessions} />
          <FactTile label="Hallucination flags" value={r.ai_behavior.hallucination_flags} />
          <FactTile label="Reverted tool calls" value={r.ai_behavior.reverted_tool_calls} />
          <FactTile label="Cache hit rate (avg)" value={`${r.ai_behavior.cache_hit_rate_avg_pct}%`} />
        </FactGrid>

        <Subhead>High-cost sessions</Subhead>
        <SimpleTable
          headers={["Session", "Member", "Cost"]}
          rows={r.ai_behavior.high_cost_sessions.map((s) => [s.session_label, s.member, `$${s.cost_usd.toFixed(2)}`])}
        />

        <Subhead>⚠ Agent helpfulness per member</Subhead>
        <SimpleTable
          headers={["⚠ Member", "Essential", "Helpful", "Neutral", "Unhelpful"]}
          rows={r.ai_behavior.agent_helpfulness_per_member.map((m) => [m.member, m.essential, m.helpful, m.neutral, m.unhelpful])}
        />
      </SectionFrame>

      {/* ─── T. Cost / efficiency ────────────────────────────────────── */}
      <SectionFrame letter="T" title={<>Cost / <em>efficiency</em></>}>
        <Subhead>Cost per PR per project</Subhead>
        <SimpleTable
          headers={["Project", "Cost", "PRs", "$/PR"]}
          rows={r.cost_efficiency.cost_per_pr_per_project.map((p) => [p.project, `$${p.cost_usd.toFixed(2)}`, p.prs, `$${p.ratio.toFixed(2)}`])}
        />

        <FactGrid cols={3}>
          <FactTile label="Tokens per PR (team)" value={r.cost_efficiency.tokens_per_pr_team.toLocaleString()} />
          <FactTile label="Plan-utilization burndown" value={`${r.cost_efficiency.plan_utilization_burndown_pct}%`} />
          <FactTile label="Cost trend WoW" value={`+${r.cost_efficiency.cost_trend_wow_pct}%`} />
        </FactGrid>

        <Subhead>Extra-usage spend per project</Subhead>
        <SimpleTable
          headers={["Project", "Extra-usage $"]}
          rows={r.cost_efficiency.extra_usage_spend_per_project.map((p) => [p.project, `$${p.usd.toFixed(2)}`])}
        />

        <Subhead>High-cost low-yield sessions</Subhead>
        {r.cost_efficiency.high_cost_low_yield_sessions.map((s, i) => (
          <NarrativeLine key={i}>
            <strong>${s.cost_usd.toFixed(2)}</strong> · {s.outcome} — {s.description}
          </NarrativeLine>
        ))}
      </SectionFrame>

      {/* ─── U. Coverage ─────────────────────────────────────────────── */}
      <SectionFrame letter="U" title={<>Coverage / <em>dead zones</em></>}>
        <FactGrid cols={3}>
          <FactTile label="Untouched files" value={r.coverage.untouched_files_count} />
          <FactTile label="New files by agent" value={r.coverage.new_files_by_agent} />
          <FactTile label="Agent-authored test files" value={r.coverage.agent_authored_test_files} />
          <FactTile label="Agent-authored doc files" value={r.coverage.agent_authored_doc_files} />
        </FactGrid>

        <Subhead>Untouched directories</Subhead>
        {r.coverage.untouched_directories.map((d) => (
          <NarrativeLine key={d}><code>{d}</code></NarrativeLine>
        ))}

        <Subhead>Universal-contact files (touched by every member)</Subhead>
        {r.coverage.universal_contact_files.map((f) => (
          <NarrativeLine key={f}><code>{f}</code></NarrativeLine>
        ))}

        <Subhead>Legacy zones with activity (refactor frontier)</Subhead>
        <SimpleTable
          headers={["Zone", "Sessions"]}
          rows={r.coverage.legacy_zones_with_activity.map((l) => [<code key={l.zone}>{l.zone}</code>, l.sessions])}
        />
      </SectionFrame>

      {/* ─── V. Trend ────────────────────────────────────────────────── */}
      <SectionFrame letter="V" title={<>Trend / <em>longitudinal</em></>} subtitle="4-week and quarter views">
        <Subhead>Skill adoption curves</Subhead>
        {r.trend.skill_adoption_curves.map((s) => (
          <FactRow key={s.skill} label={<code>{s.skill}</code>} value={<TextSparkline values={s.weekly} />} sub={s.weekly.join(" → ")} />
        ))}

        <FactGrid cols={2}>
          <FactTile label="Subagent-dispatch trend" value={<TextSparkline values={r.trend.subagent_dispatch_trend} />} sub={r.trend.subagent_dispatch_trend.join(" → ")} />
          <FactTile label="Plan-mode trend" value={<TextSparkline values={r.trend.plan_mode_trend} />} sub={r.trend.plan_mode_trend.join(" → ")} />
          <FactTile label="Velocity trend (PRs/wk)" value={<TextSparkline values={r.trend.velocity_trend} />} sub={r.trend.velocity_trend.join(" → ")} />
          <FactTile label="Cost trend" value={<TextSparkline values={r.trend.cost_trend} />} sub={r.trend.cost_trend.map((c) => `$${c.toFixed(0)}`).join(" → ")} />
          <FactTile label="Skill-authoring rate" value={<TextSparkline values={r.trend.skill_authoring_rate_trend} />} sub={r.trend.skill_authoring_rate_trend.join(" → ")} />
          <FactTile label="Maturity composite" value={<TextSparkline values={r.trend.maturity_composite_weekly} />} sub={r.trend.maturity_composite_weekly.join(" → ")} />
        </FactGrid>

        <NarrativeLine>{r.trend.diffusion_velocity_note}</NarrativeLine>
      </SectionFrame>

      {/* ─── W. Onboarding ────────────────────────────────────────────── */}
      <SectionFrame letter="W" title={<>Onboarding / <em>maturation</em></>} subtitle="New members' first weeks">
        <Subhead>Ramp-up curves</Subhead>
        {r.onboarding.ramp_up_curves.map((m) => (
          <FactRow key={m.member} label={<><strong>{m.member}</strong> · {m.weeks_since_join}w since join</>} value={<TextSparkline values={m.weekly_hours} />} sub={`weekly hours: ${m.weekly_hours.join(" → ")}`} />
        ))}

        <Subhead>First milestones since join</Subhead>
        <SimpleTable
          headers={["Member", "First skill load", "First subagent", "First plan-mode", "First PR-via-agents"]}
          rows={r.onboarding.first_skill_load.map((s) => {
            const sub = r.onboarding.first_subagent_dispatch.find((x) => x.member === s.member);
            const plan = r.onboarding.first_plan_mode.find((x) => x.member === s.member);
            const pr = r.onboarding.first_pr_via_agents.find((x) => x.member === s.member);
            return [
              s.member,
              `${s.skill} · d${s.days_since_join}`,
              sub ? `${sub.type} · d${sub.days_since_join}` : "—",
              plan ? `d${plan.days_since_join}` : "—",
              pr && pr.days_since_join ? `d${pr.days_since_join}` : "pending",
            ];
          })}
        />

        <Subhead>Time to first ship</Subhead>
        <SimpleTable
          headers={["Member", "Days"]}
          rows={r.onboarding.time_to_first_ship.map((m) => [m.member, m.days || "pending"])}
        />
      </SectionFrame>

      {/* ─── X. Manager affordances ──────────────────────────────────── */}
      <SectionFrame letter="X" title={<>Manager <em>affordances</em></>} subtitle="Auto-curated, opt-in-heavy">
        <Subhead>Wins to celebrate this week</Subhead>
        {r.manager.wins_this_week.map((w, i) => (
          <NarrativeLine key={i}><strong>{w.member}</strong> — {w.win}</NarrativeLine>
        ))}

        <Subhead>Topics for next 1:1</Subhead>
        {r.manager.topics_for_oneonone.map((t, i) => (
          <NarrativeLine key={i}><strong>{t.member}</strong> — {t.topic}</NarrativeLine>
        ))}

        <SensitiveCallout note="The next section is auto-curated 'concerns to address' — useful but easy to misuse. A manager should treat these as prompts, never as judgments." />
        <Subhead>⚠ Concerns to address</Subhead>
        {r.manager.concerns_to_address.map((c, i) => (
          <NarrativeLine key={i} sensitive><strong>{c.member}</strong> — {c.concern}</NarrativeLine>
        ))}

        <Subhead>Onboarding suggestions</Subhead>
        {r.manager.onboarding_suggestions.map((s, i) => (
          <NarrativeLine key={i}><strong>{s.member}</strong> — {s.suggestion}</NarrativeLine>
        ))}

        <Subhead>"Ask X about Y" bench</Subhead>
        <SimpleTable
          headers={["Ask", "About"]}
          rows={r.manager.ask_x_about_y.map((a) => [<strong key={a.ask_member}>{a.ask_member}</strong>, a.topic])}
        />

        <Subhead>Friday demo candidates</Subhead>
        {r.manager.friday_demo_candidates.map((d, i) => (
          <NarrativeLine key={i}>{d.session_label}</NarrativeLine>
        ))}
      </SectionFrame>

      {/* ─── Y. Org roll-up ─────────────────────────────────────────── */}
      <SectionFrame letter="Y" title={<>Org <em>roll-up</em></>} subtitle="For multi-team executive views">
        <FactGrid cols={3}>
          <FactTile label="Team maturity score" value={`${r.org_rollup.team_maturity_score.current}`} sub={`prior ${r.org_rollup.team_maturity_score.prior} · trend ${r.org_rollup.team_maturity_score.trend}`} />
          <FactTile label="Skill-authoring rate (this team)" value={`${r.org_rollup.skill_authoring_rate}/mo`} />
          <FactTile label="Quarterly agent-shipping" value={<TextSparkline values={r.org_rollup.quarterly_agent_shipping_trend} />} sub={r.org_rollup.quarterly_agent_shipping_trend.join(" → ")} />
        </FactGrid>

        <Subhead>Team vs. org baseline</Subhead>
        <SimpleTable
          headers={["Metric", "Team", "Org baseline"]}
          rows={r.org_rollup.team_vs_org_comparison.map((c) => [c.metric, c.team, c.org_baseline])}
        />

        <Subhead>⚠ ROI per team</Subhead>
        <SimpleTable
          headers={["⚠ Team", "Cost per PR"]}
          rows={r.org_rollup.roi_per_team.map((t) => [t.team, `$${t.cost_per_pr.toFixed(2)}`])}
        />

        <Subhead>⚠ Bus-factor practices (sole practitioner)</Subhead>
        <SimpleTable
          headers={["⚠ Practice", "Sole practitioner"]}
          rows={r.org_rollup.bus_factor_practices.map((b) => [b.practice, b.sole_practitioner])}
        />
      </SectionFrame>

      {/* ─── Z. Pair work / threads ──────────────────────────────────── */}
      <SectionFrame letter="Z" title={<>Pair work / <em>threads</em></>}>
        <Subhead>Multi-day continuation threads</Subhead>
        <SimpleTable
          headers={["Thread", "Member", "Days"]}
          rows={r.pair_work.multiday_continuations.map((t) => [t.thread_id, t.member, t.days])}
        />

        <Subhead>Co-authored commits (same file, same day, 2+ members)</Subhead>
        <SimpleTable
          headers={["File", "Members", "Date"]}
          rows={r.pair_work.coauthored_commits.map((c) => [<code key={c.file}>{c.file}</code>, c.members.join(" · "), c.date])}
        />

        <Subhead>Cross-session threads (one topic across N sessions)</Subhead>
        <SimpleTable
          headers={["Topic", "Sessions", "Member"]}
          rows={r.pair_work.cross_session_threads.map((t) => [t.topic, t.sessions, t.member])}
        />

        <Subhead>Hot files (touched in consecutive sessions)</Subhead>
        <SimpleTable
          headers={["File", "Consecutive sessions"]}
          rows={r.pair_work.hot_files.map((h) => [<code key={h.path}>{h.path}</code>, h.consecutive_sessions])}
        />
      </SectionFrame>

      {/* ─── AA. Outliers ────────────────────────────────────────────── */}
      <SectionFrame letter="AA" title={<>Outliers / <em>surprises</em></>}>
        <Subhead>Atypical days per member</Subhead>
        {r.outliers.atypical_day_per_member.map((d, i) => (
          <NarrativeLine key={i}><strong>{d.member}</strong> · {d.date} — {d.what_was_different}</NarrativeLine>
        ))}

        <FactGrid cols={3}>
          <FactTile label="Unexpected project attention" value={r.outliers.unexpected_project_attention.project} sub={`usual ${r.outliers.unexpected_project_attention.usual_hours}h → ${r.outliers.unexpected_project_attention.this_week}h`} />
          <FactTile label="Spiked subagent" value={r.outliers.spiked_subagent.type} sub={`usual ${r.outliers.spiked_subagent.usual}× → ${r.outliers.spiked_subagent.this_week}× this week`} />
          <FactTile label="Interrupt spike" value={r.outliers.interrupt_spike.member} sub={`usual ${r.outliers.interrupt_spike.usual}/session → ${r.outliers.interrupt_spike.this_week}/session`} />
          <FactTile label="Outlier long-autonomous" value={r.outliers.outlier_long_autonomous.member} sub={`${r.outliers.outlier_long_autonomous.hours}h vs. median ${r.outliers.outlier_long_autonomous.median}h`} />
          <FactTile label="Novel friction kind" value={r.outliers.novel_friction_kind.kind} sub={r.outliers.novel_friction_kind.member} />
        </FactGrid>

        <Subhead>Abandoned skills (outliers)</Subhead>
        {r.outliers.abandoned_skill_outliers.map((s, i) => (
          <NarrativeLine key={i}><code>{s.skill}</code> · prev {s.prev_uses} → now {s.current_uses}</NarrativeLine>
        ))}
      </SectionFrame>

      {/* ─── BB. Spotlights ──────────────────────────────────────────── */}
      <SectionFrame letter="BB" title={<>Spot<em>lights</em></>} subtitle="Member-submitted sessions · concrete agent walkthroughs">
        <SpotlightsSection spotlights={r.spotlights} />
      </SectionFrame>

      {/* ─── CC. Meta ────────────────────────────────────────────────── */}
      <SectionFrame letter="CC" title={<>Meta · dashboard <em>self-signals</em></>}>
        <FactGrid cols={3}>
          <FactTile label="Spotlight opt-in rate" value={`${r.meta.spotlight_rate_pct}%`} />
          <FactTile label="Synthesis cost (this report)" value={`$${r.meta.synthesis_cost_usd.toFixed(2)}`} />
          <FactTile label="Member-data completeness" value={`${r.meta.member_data_completeness_pct}%`} />
        </FactGrid>

        <NarrativeLine>{r.meta.data_freshness}</NarrativeLine>

        <Subhead>Section coverage</Subhead>
        <div className="section-coverage-grid">
          {r.meta.section_coverage.map((s) => (
            <span key={s.letter} className={`section-coverage-chip ${s.populated ? "filled" : "empty"}`}>
              {s.letter}
            </span>
          ))}
        </div>
      </SectionFrame>

      {/* ─── DD. Cross-edition ────────────────────────────────────────── */}
      <SectionFrame letter="DD" title={<>Cross-edition <em>affordances</em></>}>
        <Subhead>Per-member personal-digest links</Subhead>
        <SimpleTable
          headers={["Member", "Personal digest", "Link"]}
          rows={r.cross_edition.member_links.map((m) => [
            m.member,
            m.personal_digest_shared ? "shared" : "not shared",
            m.personal_digest_href ? <a key={m.member} href={m.personal_digest_href}>open →</a> : "—",
          ])}
        />

        <Subhead>Session deep-links</Subhead>
        <SimpleTable
          headers={["Session", "Link"]}
          rows={r.cross_edition.session_deep_links.map((s) => [s.session_label, <a key={s.href} href={s.href}>open →</a>])}
        />

        <Subhead>Roster snapshot</Subhead>
        <table className="roster-mini-table">
          <tbody>
            {r.cross_edition.roster.map((m) => (
              <tr key={m.membership_id}>
                <td className="roster-mini-name">{m.display_name}</td>
                <td className="roster-mini-stats">
                  {m.agent_hours.toFixed(1)}h · {m.shipped} PR{m.shipped === 1 ? "" : "s"} shipped
                </td>
                <td className="roster-mini-link">
                  <a href={`/team/${slug}/members/${m.membership_id}`}>open member detail →</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionFrame>

      <footer className="page-footer">
        <span>Fleetlens · Team Edition · maximal prototype</span>
        <span>Generated {r.generated_at}</span>
      </footer>
    </>
  );
}
