import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
  week?: string;
};

function secret(): Buffer {
  const env = process.env.FLEETLENS_ENCRYPTION_KEY;
  // Domain-separated derivation rather than hex-decoding: any env value
  // yields a sound 32-byte HMAC key (Buffer.from(.., "hex") would silently
  // truncate malformed input), and the AES-GCM use of the same env var in
  // crypto.ts never shares raw key bits with this HMAC.
  if (env) return createHash("sha256").update(`render-token:${env}`).digest();
  const g = globalThis as { __fleetlensRenderSecret?: Buffer };
  g.__fleetlensRenderSecret ??= randomBytes(32);
  return g.__fleetlensRenderSecret;
}

function sign(scope: RenderScope, exp: number): string {
  const payload = [scope.slug, scope.group, scope.week ?? "", exp].join("|");
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
