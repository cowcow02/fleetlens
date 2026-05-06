import { notFound } from "next/navigation";
import { getReview, getStatus } from "../../../../lib/self-update/service";
import { UpdateReviewView } from "../../../../components/update-review-view";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
  if (!/^\d+\.\d+\.\d+$/.test(version)) notFound();

  const [review, status] = await Promise.all([getReview(version), getStatus()]);

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Review <em>v{version}</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Running v{status.currentVersion}
            {" · "}Target v{version}
          </div>
        </div>
        <div>
          <a href="/admin/updates" className="kicker">← Back</a>
        </div>
      </div>

      <UpdateReviewView
        version={version}
        changelog={review.changelog}
        migrations={review.migrations}
      />

      <footer className="page-footer">
        <span>Fleetlens · Team Edition</span>
        <span>{new Date().toISOString()}</span>
      </footer>
    </>
  );
}
