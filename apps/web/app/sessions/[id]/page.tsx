import { notFound } from "next/navigation";
import { getSession } from "@/lib/data";
import { loadTeamForSession } from "@claude-lens/parser/fs";
import {
  teamViewToTimelineData,
  type TimelineData,
} from "./team-tab/adapter";
import { SessionView } from "./session-view";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return notFound();

  let teamProps: (TimelineData & { teamName: string }) | null = null;
  if (session.teamName) {
    const result = await loadTeamForSession(id);
    if (result) {
      teamProps = {
        ...teamViewToTimelineData(result.view, result.details),
        teamName: result.view.teamName,
      };
    }
  }

  // Strip the `raw` field from every event before serializing to the
  // client. The parser keeps `raw` around for the Debug tab, but it's a
  // full verbatim copy of the JSONL line — for an 8.7 MB session file
  // this roughly doubles the RSC payload sent over the wire. The Debug
  // tab can rebuild a useful view from the structured fields already on
  // the event (rawType, blocks, usage, model, requestId, etc.) without it.
  const stripped = {
    ...session,
    events: session.events.map((e) => ({ ...e, raw: undefined })),
  };

  return <SessionView session={stripped} team={teamProps} />;
}
