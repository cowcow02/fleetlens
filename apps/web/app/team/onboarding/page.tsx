import { redirect } from "next/navigation";
import { readTeamConfig } from "@/lib/team-config";
import { listSyncProjectRows } from "@/lib/sync-projects-data";
import { OnboardingWizard } from "./onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function TeamOnboardingPage() {
  const config = readTeamConfig();
  if (!config) redirect("/team");
  const projects = await listSyncProjectRows();
  return (
    <OnboardingWizard
      teamName={config.teamName ?? config.teamSlug}
      teamUrl={`${config.serverUrl.replace(/\/$/, "")}/team/${config.teamSlug}`}
      serverHost={new URL(config.serverUrl).host}
      projects={projects}
      initial={
        config.syncProjects ?? {
          autoIncludeNew: true,
          included: projects.map((p) => p.name),
          excluded: [],
        }
      }
      setupPending={config.setupPending ?? false}
    />
  );
}
