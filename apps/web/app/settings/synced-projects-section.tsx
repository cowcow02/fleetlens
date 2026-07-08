import { readTeamConfig } from "@/lib/team-config";
import { listSyncProjectRows } from "@/lib/sync-projects-data";
import { SyncedProjectsForm } from "./synced-projects-form";

export async function SyncedProjectsSection() {
  const config = readTeamConfig();
  if (!config) return null;

  if (config.setupPending) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Synced projects</h2>
        <p className="text-sm text-gray-500">
          Setup isn&rsquo;t finished yet — finish the{" "}
          <a className="underline" href="/team/onboarding">onboarding wizard</a>{" "}
          to choose which projects sync to your team.
        </p>
      </section>
    );
  }

  const projects = await listSyncProjectRows();
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Synced projects</h2>
      <p className="text-sm text-gray-500">
        Choose which projects share metrics with your team. Changes apply
        within ~5 minutes; already-synced history stays on the server.
      </p>
      <SyncedProjectsForm
        projects={projects}
        initial={config.syncProjects ?? { autoIncludeNew: true, included: [], excluded: [] }}
      />
    </section>
  );
}
