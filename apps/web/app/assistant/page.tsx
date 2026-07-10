import type { Metadata } from "next";
import { AssistantChat } from "@/components/assistant-chat";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Assistant — Fleetlens",
};

export default function AssistantPage() {
  return <AssistantChat />;
}
