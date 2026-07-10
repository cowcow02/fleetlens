import type { Metadata } from "next";
import { AgentChat } from "@/components/agent-chat";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent — Fleetlens",
};

export default function AssistantPage() {
  return <AgentChat />;
}
