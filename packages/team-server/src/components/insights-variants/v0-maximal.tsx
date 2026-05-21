import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";
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
} from "../insights-primitives";
import { SpotlightsSection } from "../spotlight-card";

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

export function VariantMaximal({ r, slug }: { r: TeamInsightReport; slug: string }) {
  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v0 · Maximal.</strong> The original 30-section enumeration with every conceivable item
        rendered for comparison. Useful as a reference of what you can drop — the focused variants (v1–v5)
        carry the agent-collaboration emphasis instead.
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
        <Subhead>Session length histogram</Subhead>
        <MiniBar segments={r.volume.session_length_histogram.map((b) => ({ label: b.bucket, value: b.count }))} />
        <Subhead>Cost</Subhead>
        <FactGrid cols={3}>
          <FactTile label="Total" value={`$${r.volume.cost_total_usd.toFixed(2)}`} />
          <FactTile label="Per member" value={<MiniBar segments={r.volume.cost_per_member.map((m) => ({ label: m.member, value: m.usd }))} />} />
          <FactTile label="Per project" value={<MiniBar segments={r.volume.cost_per_project.map((p) => ({ label: p.project, value: p.usd }))} />} />
        </FactGrid>
        <Subhead>⚠ Cost per shipped PR per member</Subhead>
        <SimpleTable
          headers={["⚠ Member", "$/PR"]}
          rows={r.volume.cost_per_shipped_pr_per_member.map((m) => [m.member, m.usd_per_pr ? `$${m.usd_per_pr.toFixed(2)}` : "—"])}
        />
      </SectionFrame>

      <SectionFrame letter="B" title={<>Code <em>zones</em></>} subtitle="Where the agent fleet landed">
        <Subhead>File heatmap</Subhead>
        <SimpleTable headers={["File path", "Touches", "Members"]} rows={r.code_zones.file_heatmap.map((f) => [<code key={f.path}>{f.path}</code>, f.touches, f.members])} />
        <Subhead>Multi-member files</Subhead>
        <SimpleTable headers={["File", "Members"]} rows={r.code_zones.multi_member_files.map((f) => [<code key={f.path}>{f.path}</code>, f.members.join(" · ")])} />
        <Subhead>Cold directories</Subhead>
        <SimpleTable headers={["Path", "Note"]} rows={r.code_zones.cold_directories.map((d) => [<code key={d.path}>{d.path}</code>, d.note])} />
        <Subhead>File-type mix</Subhead>
        <MiniBar segments={r.code_zones.file_type_mix.map((t) => ({ label: t.ext, value: t.share_pct }))} />
      </SectionFrame>

      <SectionFrame letter="C" title={<>Working <em>style</em></>}>
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
        <SensitiveCallout note="⚠ items below — tone, politeness, sentiment — are voyeuristic. Strong consider dropping." />
        <Subhead>⚠ Tone grade</Subhead>
        <SimpleTable headers={["⚠ Member", "Grade"]} rows={r.working_style.tone_grade_per_member.map((m) => [m.member, m.grade])} />
      </SectionFrame>

      <SectionFrame letter="D" title={<>Tool <em>usage</em></>} subtitle="Raw counts skipped">
        <MiniBar segments={r.tool_usage.bash_subverb_heatmap.map((b) => ({ label: b.subverb, value: b.count }))} />
        <FactGrid cols={3}>
          <FactTile label="Read : Edit ratio" value={r.tool_usage.read_edit_ratio.toFixed(2)} />
          <FactTile label="Tool retry chains" value={r.tool_usage.tool_retry_chains_count} />
          <FactTile label="Avg tools per turn" value={r.tool_usage.avg_tools_per_turn.toFixed(1)} />
        </FactGrid>
      </SectionFrame>

      <SectionFrame letter="E" title={<>Skills & <em>harness</em></>}>
        <Subhead>User-authored skills</Subhead>
        <SimpleTable headers={["Skill", "Author", "Adopters", "Uses"]} rows={r.skills_harness.user_authored_skills.map((s) => [<code key={s.name}>{s.name}</code>, s.originated_by, s.adopters, s.uses])} />
        <Subhead>Diffusion events</Subhead>
        {r.skills_harness.skill_diffusion_events.map((e, i) => (
          <NarrativeLine key={i}><code>{e.skill}</code> · {e.from_member} → {e.to_member} on {e.date}</NarrativeLine>
        ))}
      </SectionFrame>

      <SectionFrame letter="F" title={<>Delegation</>}>
        <MiniBar segments={r.delegation.subagent_dispatches_per_member.map((m) => ({ label: m.member, value: m.count }))} />
        <FactGrid cols={3}>
          <FactTile label="Parallel batches" value={r.delegation.parallel_vs_sequential_batches.parallel} />
          <FactTile label="Reviewer-triad sessions" value={r.delegation.reviewer_triad_sessions} />
          <FactTile label="Orchestration-brief-first" value={r.delegation.orchestration_brief_first_sessions} />
          <FactTile label="Subagent ship rate" value={`${r.delegation.subagent_shipping_rate_pct}%`} />
        </FactGrid>
      </SectionFrame>

      <SectionFrame letter="G" title={<>Plan <em>mode</em></>}>
        <FactGrid cols={3}>
          <FactTile label="Adopters" value={`${r.plan_mode.adopters} of ${r.members_total}`} />
          <FactTile label="Brainstorm-warmup adopters" value={r.plan_mode.brainstorm_warmup_adopters} />
          <FactTile label="Plans shipped" value={r.plan_mode.plans_shipped} />
          <FactTile label="Plans abandoned" value={r.plan_mode.plans_abandoned} />
          <FactTile label="Longest streak" value={`${r.plan_mode.longest_discipline_streak_days} days`} />
          <FactTile label="Avg plan duration" value={`${r.plan_mode.avg_plan_duration_min.toFixed(1)} min`} />
        </FactGrid>
      </SectionFrame>

      <SectionFrame letter="H" title={<>Outcomes</>}>
        <MiniBar segments={r.outcomes.prs_per_member.map((m) => ({ label: m.member, value: m.count }))} />
        <Subhead>Skill ↔ ship-rate</Subhead>
        <SimpleTable headers={["Skill", "Ship %"]} rows={r.outcomes.skill_ship_rate.map((s) => [<code key={s.skill}>{s.skill}</code>, `${s.ship_rate_pct}%`])} />
      </SectionFrame>

      <SectionFrame letter="I" title={<>Friction</>}>
        {r.friction.cooccurring_friction.map((c) => (
          <div key={c.kind} className="narrative-card">
            <div className="narrative-card-head"><strong>{c.kind}</strong> · {c.members_affected.join(" + ")}</div>
            <div className="narrative-card-body">{c.description}</div>
          </div>
        ))}
      </SectionFrame>

      <SectionFrame letter="J" title={<>Diffusion</>}>
        {r.diffusion.skill_pickups.map((p, i) => (
          <NarrativeLine key={i}><code>{p.skill}</code> · {p.from_member} → {p.to_member} ({p.days_to_pickup} days)</NarrativeLine>
        ))}
        <Subhead>Plan-mode adoption curve</Subhead>
        <FactRow label="Adopters/wk" value={<TextSparkline values={r.diffusion.plan_mode_curve} />} sub={r.diffusion.plan_mode_curve.join(" → ")} />
      </SectionFrame>

      <SectionFrame letter="K" title={<>Co-occurrence</>}>
        <SimpleTable headers={["File", "Members"]} rows={r.cooccurrence.shared_files_same_week.map((s) => [<code key={s.path}>{s.path}</code>, s.members.join(" · ")])} />
        <SimpleTable headers={["Date", "Window", "Members"]} rows={r.cooccurrence.concurrent_sessions.map((s, i) => [s.date, s.window, <ChipRow key={i} items={s.members} />])} />
      </SectionFrame>

      <SectionFrame letter="L" title={<>Team <em>bench</em></>}>
        <SimpleTable headers={["Category", "Member", "Metric"]} rows={r.bench.task_category_bench.map((b) => [b.category, <strong key={b.member}>{b.member}</strong>, b.metric_label])} />
      </SectionFrame>

      <SectionFrame letter="M" title={<>Novelty</>}>
        <div className="invention-card">
          <div className="invention-card-label">The week's invention</div>
          <h3 className="invention-card-title">{r.novelty.weeks_invention.headline}</h3>
          <div className="invention-card-meta">{r.novelty.weeks_invention.member} · {r.novelty.weeks_invention.session_date} · {r.novelty.weeks_invention.project}</div>
          <p className="invention-card-body">{r.novelty.weeks_invention.detail}</p>
        </div>
      </SectionFrame>

      <SectionFrame letter="N" title={<>External systems</>}>
        <SimpleTable headers={["Ref", "Member", "Sessions"]} rows={r.external_systems.linear_refs.map((l) => [<code key={l.ref}>{l.ref}</code>, l.member, l.sessions])} />
      </SectionFrame>

      <SectionFrame letter="O" title={<>Prompting fingerprint</>}>
        <SimpleTable headers={["Member", "Style", "Descriptor"]} rows={r.prompting_fingerprint.style_per_member.map((s) => [s.member, <strong key={s.style}>{s.style}</strong>, s.descriptor])} />
      </SectionFrame>

      <SectionFrame letter="P" title={<>Rhythm</>}>
        <FactRow label="Team hour 0→23" value={<TextSparkline values={r.rhythm.team_hour_histogram} />} />
        <SensitiveCallout note="Late-night / weekend / burnout-proxy items are wellbeing-adjacent." />
        <Subhead>⚠ Burnout proxy</Subhead>
        {r.rhythm.burnout_proxy.map((b, i) => <NarrativeLine key={i} sensitive><strong>{b.member}</strong> · {b.signal}</NarrativeLine>)}
      </SectionFrame>

      <SectionFrame letter="Q" title={<>Velocity</>}>
        <FactRow label="PRs/week trend" value={<TextSparkline values={r.velocity.prs_per_week_trend} />} sub={r.velocity.prs_per_week_trend.join(" → ")} />
      </SectionFrame>

      <SectionFrame letter="R" title={<>Knowledge flow</>}>
        {r.knowledge_flow.pattern_a_to_b.map((p, i) => (
          <NarrativeLine key={i}><em>“{p.pattern}”</em> · {p.member_a} ({p.date_a}) → {p.member_b} ({p.date_b})</NarrativeLine>
        ))}
      </SectionFrame>

      <SectionFrame letter="S" title={<>AI behavior</>}>
        <MiniBar segments={r.ai_behavior.model_usage.map((m) => ({ label: m.model, value: m.share_pct }))} />
      </SectionFrame>

      <SectionFrame letter="T" title={<>Cost</>}>
        <SimpleTable headers={["Project", "Cost", "PRs", "$/PR"]} rows={r.cost_efficiency.cost_per_pr_per_project.map((p) => [p.project, `$${p.cost_usd.toFixed(2)}`, p.prs, `$${p.ratio.toFixed(2)}`])} />
      </SectionFrame>

      <SectionFrame letter="U" title={<>Coverage</>}>
        <FactTile label="Untouched files" value={r.coverage.untouched_files_count} />
      </SectionFrame>

      <SectionFrame letter="V" title={<>Trend</>}>
        {r.trend.skill_adoption_curves.map((s) => (
          <FactRow key={s.skill} label={<code>{s.skill}</code>} value={<TextSparkline values={s.weekly} />} sub={s.weekly.join(" → ")} />
        ))}
      </SectionFrame>

      <SectionFrame letter="W" title={<>Onboarding</>}>
        {r.onboarding.ramp_up_curves.map((m) => (
          <FactRow key={m.member} label={<><strong>{m.member}</strong></>} value={<TextSparkline values={m.weekly_hours} />} sub={`${m.weekly_hours.join(" → ")}h`} />
        ))}
      </SectionFrame>

      <SectionFrame letter="X" title={<>Manager affordances</>}>
        {r.manager.wins_this_week.map((w, i) => <NarrativeLine key={i}><strong>{w.member}</strong> — {w.win}</NarrativeLine>)}
        <SensitiveCallout note="The 'concerns' list below is auto-curated — easy to misuse." />
        {r.manager.concerns_to_address.map((c, i) => <NarrativeLine key={i} sensitive><strong>{c.member}</strong> — {c.concern}</NarrativeLine>)}
      </SectionFrame>

      <SectionFrame letter="Y" title={<>Org roll-up</>}>
        <SimpleTable headers={["Metric", "Team", "Org baseline"]} rows={r.org_rollup.team_vs_org_comparison.map((c) => [c.metric, c.team, c.org_baseline])} />
      </SectionFrame>

      <SectionFrame letter="Z" title={<>Pair work</>}>
        <SimpleTable headers={["Thread", "Member", "Days"]} rows={r.pair_work.multiday_continuations.map((t) => [t.thread_id, t.member, t.days])} />
      </SectionFrame>

      <SectionFrame letter="AA" title={<>Outliers</>}>
        {r.outliers.atypical_day_per_member.map((d, i) => <NarrativeLine key={i}><strong>{d.member}</strong> · {d.date} — {d.what_was_different}</NarrativeLine>)}
      </SectionFrame>

      <SectionFrame letter="BB" title={<>Spotlights</>}>
        <SpotlightsSection spotlights={r.spotlights} />
      </SectionFrame>

      <SectionFrame letter="CC" title={<>Meta</>}>
        <div className="section-coverage-grid">
          {r.meta.section_coverage.map((s) => (
            <span key={s.letter} className={`section-coverage-chip ${s.populated ? "filled" : "empty"}`}>{s.letter}</span>
          ))}
        </div>
      </SectionFrame>

      <SectionFrame letter="DD" title={<>Cross-edition</>}>
        <table className="roster-mini-table">
          <tbody>
            {r.cross_edition.roster.map((m) => (
              <tr key={m.membership_id}>
                <td className="roster-mini-name">{m.display_name}</td>
                <td className="roster-mini-stats">{m.agent_hours.toFixed(1)}h · {m.shipped} PR{m.shipped === 1 ? "" : "s"} shipped</td>
                <td className="roster-mini-link"><a href={`/team/${slug}/members/${m.membership_id}`}>open member detail →</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionFrame>
    </div>
  );
}
