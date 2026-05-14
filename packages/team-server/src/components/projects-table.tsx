import type { ProjectRow } from "../app/team/[slug]/insights/types";

export function ProjectsTableSection({ projects }: { projects: ProjectRow[] }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Projects this <em>week</em></h2>
        <div className="kicker">Where the team's agent time landed</div>
      </div>

      <table className="projects-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Agent hours</th>
            <th>Members</th>
            <th>Shipped</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.name}>
              <td className="proj-name">{p.display_name}</td>
              <td>{p.agent_hours.toFixed(1)}h</td>
              <td className="proj-members">{p.members.join(" · ")}</td>
              <td>{p.shipped_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
