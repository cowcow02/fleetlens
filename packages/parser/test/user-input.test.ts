import { describe, it, expect } from "vitest";
import { isFrameworkInjectedUserInput } from "../src/user-input.js";

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

  it("flags Conductor's <system_instruction> block", () => {
    const conductor =
      "<system_instruction>\nYou are working inside Conductor, a Mac app...\n</system_instruction>";
    expect(isFrameworkInjectedUserInput(conductor)).toBe(true);
  });

  it("flags <system_instruction with attributes (no closing >)", () => {
    expect(isFrameworkInjectedUserInput('<system_instruction id="x">body</system_instruction>')).toBe(true);
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
