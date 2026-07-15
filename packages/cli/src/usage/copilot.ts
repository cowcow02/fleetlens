import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UsageSnapshot } from "./api.js";

const RPC_TIMEOUT_MS = 10_000;

export class CopilotApiError extends Error {
  constructor(
    message: string,
    readonly code: "no_cli" | "no_auth" | "protocol" | "parse" | "timeout",
  ) {
    super(message);
  }
}

type QuotaSnapshot = {
  isUnlimitedEntitlement?: unknown;
  entitlementRequests?: unknown;
  usedRequests?: unknown;
  remainingPercentage?: unknown;
  resetDate?: unknown;
  hasQuota?: unknown;
  tokenBasedBilling?: unknown;
};

type QuotaResult = {
  quotaSnapshots?: unknown;
};

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function nextCopilotMonthlyReset(nowMs: number = Date.now()): string {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function quotaResetDate(value: unknown, nowMs: number): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  // Copilot CLI 1.0.x maps quota timestamp_utc (the observation time) into
  // resetDate. Accept a future reset when the SDK fixes that mapping.
  return Number.isFinite(parsed) && parsed > nowMs + 60_000
    ? new Date(parsed).toISOString()
    : nextCopilotMonthlyReset(nowMs);
}

/** Normalize the public SDK quota shape without depending on the SDK package. */
export function parseCopilotQuota(
  body: unknown,
  nowMs: number = Date.now(),
): UsageSnapshot {
  const root = recordOf(body as QuotaResult);
  const snapshots = recordOf(root?.quotaSnapshots);
  if (!snapshots) {
    throw new CopilotApiError("Copilot quota response missing quotaSnapshots", "parse");
  }

  const chat = recordOf(snapshots.chat) as QuotaSnapshot | undefined;
  const legacy = recordOf(snapshots.premium_interactions) as QuotaSnapshot | undefined;
  const chatLimit = numberOf(chat?.entitlementRequests);
  const quota = chat && (chatLimit !== undefined && chatLimit > 0 || chat.isUnlimitedEntitlement === true)
    ? chat
    : legacy;
  if (!quota) {
    throw new CopilotApiError("Copilot quota response has no chat allowance", "parse");
  }

  const unlimited = quota.isUnlimitedEntitlement === true;
  const remainingPercent = numberOf(quota.remainingPercentage);
  const utilization = unlimited
    ? null
    : remainingPercent === undefined
      ? null
      : clampPercent(100 - remainingPercent);
  const limit = numberOf(quota.entitlementRequests) ?? null;
  const used = numberOf(quota.usedRequests) ?? null;
  const unit = quota.tokenBasedBilling === true ? "ai-credits" : "premium-requests";

  return {
    captured_at: new Date(nowMs).toISOString(),
    agent: "copilot",
    five_hour: { utilization: null, resets_at: null },
    seven_day: { utilization: null, resets_at: null },
    monthly: {
      utilization,
      resets_at: quotaResetDate(quota.resetDate, nowMs),
    },
    monthly_quota: {
      used,
      limit,
      remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null,
      unit,
      unlimited,
    },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    plan_type: unit === "ai-credits" ? "AI credits" : "premium requests",
  };
}

export class ContentLengthDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
      if (!match) {
        throw new CopilotApiError("Copilot RPC response missing Content-Length", "protocol");
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        messages.push(JSON.parse(body));
      } catch {
        throw new CopilotApiError("Copilot RPC returned invalid JSON", "protocol");
      }
    }
    return messages;
  }
}

function rpcFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
    body,
  ]);
}

export function resolveCopilotCliPath(): string {
  const configured = process.env.COPILOT_CLI_PATH?.trim();
  if (configured) return configured;
  const sibling = join(dirname(process.execPath), process.platform === "win32" ? "copilot.cmd" : "copilot");
  return existsSync(sibling) ? sibling : process.platform === "win32" ? "copilot.cmd" : "copilot";
}

async function requestQuota(child: ChildProcessWithoutNullStreams): Promise<unknown> {
  const decoder = new ContentLengthDecoder();
  const pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();
  let nextId = 1;

  const rejectAll = (error: Error): void => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  child.stdout.on("data", (chunk: Buffer) => {
    try {
      for (const value of decoder.push(chunk)) {
        const message = recordOf(value);
        const id = numberOf(message?.id);
        if (id === undefined) continue;
        const waiter = pending.get(id);
        if (!waiter) continue;
        pending.delete(id);
        const rpcError = recordOf(message?.error);
        if (rpcError) {
          waiter.reject(new CopilotApiError(
            typeof rpcError.message === "string" ? rpcError.message : "Copilot RPC request failed",
            "protocol",
          ));
        } else {
          waiter.resolve(message?.result);
        }
      }
    } catch (error) {
      rejectAll(error as Error);
    }
  });

  const exited = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      reject(new CopilotApiError(
        error.message,
        (error as NodeJS.ErrnoException).code === "ENOENT" ? "no_cli" : "protocol",
      ));
    });
    child.once("exit", (code) => {
      reject(new CopilotApiError(`Copilot RPC exited before responding (code ${code ?? "unknown"})`, "protocol"));
    });
  });

  const request = (method: string, params: unknown = {}): Promise<unknown> => {
    const id = nextId++;
    const response = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(rpcFrame({ jsonrpc: "2.0", id, method, params }));
    });
    return Promise.race([response, exited]);
  };

  await request("connect", {});
  return request("account.getQuota", {});
}

/** Poll the quota using Copilot CLI's own authenticated headless runtime. */
export async function fetchCopilotUsage(): Promise<UsageSnapshot> {
  const cliPath = resolveCopilotCliPath();
  const child = spawn(cliPath, ["--headless", "--no-auto-update", "--stdio", "--log-level", "none"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32",
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-2_000);
  });

  const timeout = new Promise<never>((_, reject) => {
    const handle = setTimeout(() => {
      reject(new CopilotApiError("Timed out reading Copilot quota", "timeout"));
    }, RPC_TIMEOUT_MS);
    handle.unref();
  });

  try {
    const body = await Promise.race([requestQuota(child), timeout]);
    return parseCopilotQuota(body);
  } catch (error) {
    if (error instanceof CopilotApiError) {
      const message = `${error.message} ${stderr}`.toLowerCase();
      if (message.includes("not logged") || message.includes("authentication")) {
        throw new CopilotApiError("Copilot not logged in. Run `copilot login`.", "no_auth");
      }
      throw error;
    }
    throw new CopilotApiError((error as Error).message, "protocol");
  } finally {
    child.kill();
  }
}
