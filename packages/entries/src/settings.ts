import {
  readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync, existsSync,
} from "node:fs";
import { dirname } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";

export type AiFeaturesSettings = {
  enabled: boolean;
  model: string;
  monthlyBudgetUsd: number | null;
  autoBackfillLastWeek: boolean;
  autoBackfillYesterday: boolean;
};

export type Settings = {
  ai_features: AiFeaturesSettings;
};

const DEFAULT_SETTINGS: Settings = {
  ai_features: {
    enabled: true,
    model: "sonnet",
    monthlyBudgetUsd: null,
    autoBackfillLastWeek: true,
    autoBackfillYesterday: true,
  },
};

let settingsPathCached: string | null = null;

function settingsPath(): string {
  if (settingsPathCached) return settingsPathCached;
  settingsPathCached = cclensPath("settings.json");
  return settingsPathCached;
}

/** @internal Test-only. */
export function __setSettingsPathForTest(path: string): void {
  settingsPathCached = path;
}

type SettingsOnDisk = {
  ai_features: {
    enabled: boolean;
    model: string;
    monthly_budget_usd: number | null;
    auto_backfill_last_week: boolean;
    auto_backfill_yesterday: boolean;
  };
};

function toDisk(s: Settings): SettingsOnDisk {
  return {
    ai_features: {
      enabled: s.ai_features.enabled,
      model: s.ai_features.model,
      monthly_budget_usd: s.ai_features.monthlyBudgetUsd,
      auto_backfill_last_week: s.ai_features.autoBackfillLastWeek,
      auto_backfill_yesterday: s.ai_features.autoBackfillYesterday,
    },
  };
}

function fromDisk(d: Partial<SettingsOnDisk>): Settings {
  const af: Partial<SettingsOnDisk["ai_features"]> = d.ai_features ?? {};
  return {
    ai_features: {
      enabled: af.enabled ?? DEFAULT_SETTINGS.ai_features.enabled,
      model: af.model ?? DEFAULT_SETTINGS.ai_features.model,
      monthlyBudgetUsd: af.monthly_budget_usd ?? null,
      autoBackfillLastWeek: af.auto_backfill_last_week ?? DEFAULT_SETTINGS.ai_features.autoBackfillLastWeek,
      autoBackfillYesterday: af.auto_backfill_yesterday ?? DEFAULT_SETTINGS.ai_features.autoBackfillYesterday,
    },
  };
}

export function readSettings(): Settings {
  const p = settingsPath();
  if (!existsSync(p)) return DEFAULT_SETTINGS;
  try {
    const raw = readFileSync(p, "utf8");
    return fromDisk(JSON.parse(raw) as Partial<SettingsOnDisk>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(s: Settings): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(toDisk(s), null, 2), { encoding: "utf8" });
  if (process.platform !== "win32") {
    chmodSync(tmp, 0o600);
  }
  renameSync(tmp, p);
}
