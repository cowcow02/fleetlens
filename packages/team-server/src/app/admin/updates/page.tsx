import { getStatus } from "../../../lib/self-update/service";
import { CheckNowButton } from "../../../components/check-now-button";

export default async function UpdatesPage() {
  const status = await getStatus();
  const lastChecked = status.lastCheckedAt ? new Date(status.lastCheckedAt) : null;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Server <em>Updates</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Running v{status.currentVersion}
            {lastChecked && (
              <>
                {" · "}Last checked {lastChecked.toISOString()}
              </>
            )}
          </div>
        </div>
        <div className="kicker">Staff only</div>
      </div>

      {status.updateAvailable && status.latestVersion ? (
        <section style={{ marginBottom: 32 }}>
          <div className="subsection-head">
            <h2>v{status.latestVersion} available</h2>
            <a href={`/admin/updates/${status.latestVersion}`} className="kicker">
              Review update →
            </a>
          </div>
          <p style={{ marginTop: 12 }}>
            A newer version of the team server is available on GHCR. Click{" "}
            <a href={`/admin/updates/${status.latestVersion}`} style={{ textDecoration: "underline" }}>
              Review update
            </a>{" "}
            to see the changelog and any database migrations before applying.
          </p>
        </section>
      ) : (
        <section style={{ marginBottom: 32 }}>
          <p>You are on the latest version.</p>
        </section>
      )}

      <section>
        <div className="subsection-head">
          <h2>Check for updates</h2>
        </div>
        <p style={{ marginTop: 12, marginBottom: 16 }}>
          The scheduler polls for new releases hourly. You can also force a check now.
        </p>
        <CheckNowButton />
      </section>

      <footer className="page-footer">
        <span>Fleetlens · Team Edition</span>
        <span>{new Date().toISOString()}</span>
      </footer>
    </>
  );
}
