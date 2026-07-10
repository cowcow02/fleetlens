import { describe, expect, test } from "vitest";
import { classifyHref } from "./links";

describe("classifyHref", () => {
  test("session links render as internal links", () => {
    expect(classifyHref("/sessions/abc-123")).toBe("session");
    expect(classifyHref("/sessions/abc-123?day=2026-07-01")).toBe("session");
  });

  test("absolute http(s) links render as external links", () => {
    expect(classifyHref("https://github.com/cowcow02/fleetlens/pull/88")).toBe("external");
    expect(classifyHref("http://example.com")).toBe("external");
  });

  test("relative and unknown hrefs are unwrapped to plain text", () => {
    expect(classifyHref("project_team_onboarding_wizard.md")).toBe("text");
    expect(classifyHref("docs/some-notes.md")).toBe("text");
    expect(classifyHref("/projects/foo")).toBe("text");
    expect(classifyHref("")).toBe("text");
    expect(classifyHref(undefined)).toBe("text");
  });

  test("javascript and data urls are never rendered as links", () => {
    expect(classifyHref("javascript:alert(1)")).toBe("text");
    expect(classifyHref("data:text/html,hi")).toBe("text");
  });
});
