import { readSettings } from "@claude-lens/entries/node";
import { AiFeaturesForm } from "./ai-features-form";
import { TeamConnectionSection } from "./team-connection-section";
import { SyncedProjectsSection } from "./synced-projects-section";

export default function SettingsPage() {
  const s = readSettings();
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Fleetlens Settings</h1>

      <TeamConnectionSection />

      <SyncedProjectsSection />

      <section>
        <h2 className="text-lg font-medium mb-2">AI Features</h2>
        <p className="text-sm text-gray-500 mb-4">
          When enabled, Fleetlens synthesizes daily digests and per-entry
          narratives by spawning your local <code>claude</code> CLI (uses your
          existing Claude Code auth — no API key required).
        </p>
        <AiFeaturesForm initial={{
          enabled: s.ai_features.enabled,
          autoBackfillLastWeek: s.ai_features.autoBackfillLastWeek,
          autoBackfillYesterday: s.ai_features.autoBackfillYesterday,
        }} />
      </section>
    </main>
  );
}
