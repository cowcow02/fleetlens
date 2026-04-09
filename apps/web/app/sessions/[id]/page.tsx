import { notFound } from "next/navigation";
import { getSession } from "@/lib/data";
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
  return <SessionView session={session} />;
}
