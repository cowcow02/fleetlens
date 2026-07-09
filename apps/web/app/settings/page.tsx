import { readSettings } from "@claude-lens/entries/node";
import { AiFeaturesForm } from "./ai-features-form";
import { readAutostartState } from "@/lib/autostart-data";
import { AutostartToggle } from "@/components/autostart-toggle";
import { readMenubarState } from "@/lib/menubar-data";
import { MenubarInstall } from "@/components/menubar-install";

// Layout mirrors /team: max-w-3xl, header + subtitle, card-style sections.
export default function SettingsPage() {
  const s = readSettings();
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Local machine preferences. Team-sync management lives on the Team page.
        </p>
      </header>

      <section className="af-card space-y-3">
        <h2 className="text-lg font-medium">Daemon auto-start</h2>
        <p className="text-sm text-gray-500">
          Brings the dashboard, plan-usage polling, and team sync back after a
          reboot. Team pairing turns this on by default.
        </p>
        <AutostartToggle initial={readAutostartState()} />
      </section>

      <section className="af-card space-y-3">
        <h2 className="text-lg font-medium">Menu bar widget</h2>
        <p className="text-sm text-gray-500">
          Native macOS menu bar widget showing live Claude Code / Codex / Z.ai plan
          utilization, reset countdowns, and burn-rate. Installs to ~/Applications
          and updates as the daemon polls.
        </p>
        <MenubarInstall initial={readMenubarState()} />
      </section>

      <section className="af-card space-y-3">
        <h2 className="text-lg font-medium">AI Features</h2>
        <p className="text-sm text-gray-500">
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
