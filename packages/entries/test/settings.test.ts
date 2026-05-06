import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSettings,
  writeSettings,
  __setSettingsPathForTest,
  type Settings,
} from "../src/settings.js";

describe("settings", () => {
  let path: string;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "settings-"));
    path = join(tmp, "settings.json");
    __setSettingsPathForTest(path);
  });

  it("readSettings returns Phase-2 defaults when file does not exist", () => {
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(true);
    expect(s.ai_features.model).toBe("sonnet");
    expect(s.ai_features.monthlyBudgetUsd).toBeNull();
    expect(s.ai_features.autoBackfillLastWeek).toBe(true);
    expect(s.ai_features.autoBackfillYesterday).toBe(true);
  });

  it("writeSettings persists JSON atomically with snake_case on-disk shape + chmod 600", () => {
    const s: Settings = {
      ai_features: {
        enabled: true,
        model: "sonnet",
        monthlyBudgetUsd: 5,
        autoBackfillLastWeek: true,
        autoBackfillYesterday: true,
      },
    };
    writeSettings(s);
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(JSON.parse(raw)).toEqual({
      ai_features: {
        enabled: true,
        model: "sonnet",
        monthly_budget_usd: 5,
        auto_backfill_last_week: true,
        auto_backfill_yesterday: true,
      },
    });
    if (process.platform !== "win32") {
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("round-trips: writeSettings then readSettings returns the same shape", () => {
    const original: Settings = {
      ai_features: {
        enabled: false,
        model: "opus",
        monthlyBudgetUsd: 10.5,
        autoBackfillLastWeek: false,
        autoBackfillYesterday: false,
      },
    };
    writeSettings(original);
    expect(readSettings()).toEqual(original);
  });

  it("defaults autoBackfillLastWeek to true when on-disk settings predate the field", () => {
    writeFileSync(path, JSON.stringify({
      ai_features: { enabled: true, model: "sonnet", monthly_budget_usd: null },
    }));
    const s = readSettings();
    expect(s.ai_features.autoBackfillLastWeek).toBe(true);
  });

  it("defaults autoBackfillYesterday to true when on-disk settings predate the field", () => {
    writeFileSync(path, JSON.stringify({
      ai_features: { enabled: true, model: "sonnet", monthly_budget_usd: null },
    }));
    const s = readSettings();
    expect(s.ai_features.autoBackfillYesterday).toBe(true);
  });

  it("preserves autoBackfillLastWeek=false across round-trip", () => {
    writeFileSync(path, JSON.stringify({
      ai_features: {
        enabled: true, model: "sonnet", monthly_budget_usd: null,
        auto_backfill_last_week: false,
      },
    }));
    const s = readSettings();
    expect(s.ai_features.autoBackfillLastWeek).toBe(false);
    writeSettings(s);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.ai_features.auto_backfill_last_week).toBe(false);
  });

  it("preserves autoBackfillYesterday=false across round-trip", () => {
    writeFileSync(path, JSON.stringify({
      ai_features: {
        enabled: true, model: "sonnet", monthly_budget_usd: null,
        auto_backfill_yesterday: false,
      },
    }));
    const s = readSettings();
    expect(s.ai_features.autoBackfillYesterday).toBe(false);
    writeSettings(s);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.ai_features.auto_backfill_yesterday).toBe(false);
  });

  it("tolerates malformed JSON by returning defaults (enabled=true per Phase 2)", () => {
    writeFileSync(path, "{not json");
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(true);
  });
});
