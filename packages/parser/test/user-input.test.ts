import { describe, it, expect } from "vitest";
import {
  isFrameworkInjectedUserInput,
  stripFrameworkBoilerplate,
} from "../src/user-input.js";

describe("isFrameworkInjectedUserInput", () => {
  it("flags Claude Code's <command-name>", () => {
    expect(isFrameworkInjectedUserInput("<command-name>/commit</command-name>")).toBe(true);
  });

  it("flags <local-command-caveat>", () => {
    expect(isFrameworkInjectedUserInput("<local-command-caveat>cd / failed</local-command-caveat>")).toBe(true);
  });

  it("flags <local-command-stdout>", () => {
    expect(isFrameworkInjectedUserInput("<local-command-stdout>OK</local-command-stdout>")).toBe(true);
  });

  it("flags <task-notification>", () => {
    expect(isFrameworkInjectedUserInput("<task-notification>...</task-notification>")).toBe(true);
  });

  it("flags a pure <system_instruction> wrapper (nothing after)", () => {
    const wrapperOnly =
      "<system_instruction>\nYou are working inside Conductor, a Mac app...\n</system_instruction>";
    expect(isFrameworkInjectedUserInput(wrapperOnly)).toBe(true);
  });

  it("flags <system_instruction with attributes (wrapper-only)", () => {
    expect(isFrameworkInjectedUserInput('<system_instruction id="x">body</system_instruction>')).toBe(true);
  });

  it("does NOT flag a wrapper that has trailing user prose (real Conductor shape)", () => {
    const wrapped =
      "<system_instruction>\nharness context\n</system_instruction>\n\ncan you fix the bug";
    expect(isFrameworkInjectedUserInput(wrapped)).toBe(false);
  });

  it("flags 'Base directory for this skill:'", () => {
    expect(
      isFrameworkInjectedUserInput("Base directory for this skill: /path\n# Skill body"),
    ).toBe(true);
  });

  it("does not flag ordinary prose", () => {
    expect(isFrameworkInjectedUserInput("can you fix the bug")).toBe(false);
  });

  it("does not flag empty string", () => {
    expect(isFrameworkInjectedUserInput("")).toBe(false);
  });

  it("requires anchor at start (does not match mid-string)", () => {
    expect(
      isFrameworkInjectedUserInput("hello there <command-name>/foo</command-name>"),
    ).toBe(false);
  });
});

describe("stripFrameworkBoilerplate", () => {
  it("excises a <system_instruction> wrapper and keeps the trailing prose", () => {
    const wrapped =
      "<system_instruction>\nYou are working inside Conductor.\n</system_instruction>\n\ncan you fix the bug in foo.ts";
    expect(stripFrameworkBoilerplate(wrapped)).toBe("can you fix the bug in foo.ts");
  });

  it("returns empty string for a pure wrapper", () => {
    expect(
      stripFrameworkBoilerplate(
        "<system_instruction>\nharness context\n</system_instruction>",
      ),
    ).toBe("");
  });

  it("handles <system_instruction> with attributes", () => {
    const wrapped = '<system_instruction id="x">body</system_instruction>\n\nreal prompt';
    expect(stripFrameworkBoilerplate(wrapped)).toBe("real prompt");
  });

  it("leaves prose without wrappers untouched", () => {
    expect(stripFrameworkBoilerplate("can you fix X")).toBe("can you fix X");
  });

  it("handles empty input", () => {
    expect(stripFrameworkBoilerplate("")).toBe("");
  });

  it("strips wrapper followed by another framework prefix (still flagged via isFrameworkInjectedUserInput)", () => {
    // After stripping the wrapper we get "<command-name>/foo</command-name>" which IS injected.
    const wrappedSlash =
      "<system_instruction>x</system_instruction>\n\n<command-name>/foo</command-name>";
    expect(stripFrameworkBoilerplate(wrappedSlash)).toBe(
      "<command-name>/foo</command-name>",
    );
    expect(isFrameworkInjectedUserInput(wrappedSlash)).toBe(true);
  });
});
