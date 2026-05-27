import { createHash } from "node:crypto";

/**
 * Derive the 32-byte Hyperswarm topic from the fleet secret.
 *
 * Topic = SHA-256("fleetlens-fleet:v1:" || secret). Domain-separated so an
 * unrelated swarm that happens to use the same secret bytes for something
 * else doesn't collide. The "v1" tag is bumped if we ever change the
 * derivation (e.g. switching hash).
 */
export function deriveTopic(fleetSecretHex: string): Buffer {
  const secret = Buffer.from(fleetSecretHex, "hex");
  return createHash("sha256")
    .update("fleetlens-fleet:v1:")
    .update(secret)
    .digest();
}
