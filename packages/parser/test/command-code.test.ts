import { describe, expect, it } from "vitest";
import { agentMetadata, getAgentMetadata, isAgentKind } from "../src/agent-metadata.js";

describe("command-code metadata", () => {
  it("registers command-code in browser-safe agentMetadata", () => {
    const meta = getAgentMetadata("command-code");
    expect(meta).toBeDefined();
    expect(meta!.kind).toBe("command-code");
    expect(meta!.displayName).toBe("Command Code");
    expect(meta!.shortLabel).toBe("Cmd");
    expect(meta!.accentColor).toBeTruthy();
    expect(meta!.iconChar).toBe(">");
    expect(agentMetadata.some((m) => m.kind === "command-code")).toBe(true);
    expect(isAgentKind("command-code")).toBe(true);
    expect(isAgentKind("cmd")).toBe(false);
  });
});
