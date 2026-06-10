import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Short-lived bearer token gating /report/[slug] to the headless PDF render —
// the page is a print layout, not a destination, so it shouldn't answer plain
// browser sessions. Signed (HMAC over the exact report scope) rather than
// stored so it survives multi-replica deployments. Secret falls back to a
// per-boot random value kept on globalThis because Next dev compiles route
// handlers and pages into separate module graphs — a module-level value would
// be two values.

const TTL_MS = 90_000;

export type RenderScope = {
  slug: string;
  group: string;
  coaching: boolean;
  mock: boolean;
  week?: string;
};

function secret(): Buffer {
  const env = process.env.FLEETLENS_ENCRYPTION_KEY;
  if (env) return Buffer.from(env, "hex");
  const g = globalThis as { __fleetlensRenderSecret?: Buffer };
  g.__fleetlensRenderSecret ??= randomBytes(32);
  return g.__fleetlensRenderSecret;
}

function sign(scope: RenderScope, exp: number): string {
  const payload = [scope.slug, scope.group, scope.coaching ? 1 : 0, scope.mock ? 1 : 0, scope.week ?? "", exp].join("|");
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function mintRenderToken(scope: RenderScope, now = Date.now()): string {
  const exp = now + TTL_MS;
  return `${exp}.${sign(scope, exp)}`;
}

export function verifyRenderToken(token: string | undefined, scope: RenderScope, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp <= now) return false;
  const expected = Buffer.from(sign(scope, exp));
  const got = Buffer.from(token.slice(dot + 1));
  return got.length === expected.length && timingSafeEqual(got, expected);
}
