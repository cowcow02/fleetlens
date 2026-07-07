import { LogViewer } from "../../../components/log-viewer";

// Auth is enforced by admin/layout.tsx (staff-only redirect) + the API route.
export const dynamic = "force-dynamic";

export default function AdminLogsPage() {
  return (
    <>
      <div className="section-head">
        <div>
          <h1>
            Server <em>Logs</em>
          </h1>
          <div className="kicker" style={{ marginTop: 8, maxWidth: "70ch" }}>
            The raw application log this instance has emitted — every ingest push, scheduler
            run, migration, and error, newest at the bottom. Persisted to Postgres, so it
            survives a restart (the last few thousand lines are restored on boot).
          </div>
        </div>
        <div className="kicker">Staff only</div>
      </div>

      <LogViewer />
    </>
  );
}
