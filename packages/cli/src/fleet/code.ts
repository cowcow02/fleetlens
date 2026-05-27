import { randomBytes, createHash } from "node:crypto";

/**
 * Fleet code = human-shareable representation of a 16-byte fleet secret.
 *
 * Wire format:  `flv1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
 *   - "flv1" version tag (versioned so we can rotate the derivation later)
 *   - 7 groups of 4 chars from a Crockford-style base32 alphabet (no I/L/O/U,
 *     case-insensitive). 26 chars total payload = 130 bits, of which 128 are
 *     the secret and the last 2 are a simple checksum.
 *
 * The secret itself is 16 bytes (128 bits). That's enough for a "shared
 * trust token" — anyone who knows it can join the fleet swarm.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const PAYLOAD_CHARS = 26; // 26 base32 chars carry 130 bits
const SECRET_BYTES = 16;

export const FLEET_CODE_PREFIX = "flv1";

export function generateFleetSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

export function encodeFleetCode(secret: Buffer): string {
  if (secret.length !== SECRET_BYTES) {
    throw new Error(`fleet secret must be ${SECRET_BYTES} bytes`);
  }
  const checksum = createHash("sha256").update(secret).digest();
  // 26 base32 chars = 130 bits = 128-bit secret + 2 checksum bits. base32
  // packs MSB-first, so the 2 checksum bits must live in the *top* two
  // bits of byte[16] for them to survive truncation to 26 chars.
  // Note: 2 bits = 1-in-4 false-positive rate. This is a typo guard, not
  // a cryptographic integrity check — never use it to authorize anything.
  const payload = Buffer.concat([secret, Buffer.from([(checksum[0] & 0x03) << 6])]);
  const chars = base32Encode(payload).slice(0, PAYLOAD_CHARS);
  return `${FLEET_CODE_PREFIX}-${groupBy4(chars).join("-")}`;
}

export function decodeFleetCode(code: string): Buffer {
  const trimmed = code.trim().toLowerCase().replace(/[-_\s]/g, "");
  const expectedPrefix = FLEET_CODE_PREFIX.toLowerCase();
  if (!trimmed.startsWith(expectedPrefix)) {
    throw new Error(`fleet code must start with "${FLEET_CODE_PREFIX}-"`);
  }
  const body = trimmed.slice(expectedPrefix.length).toUpperCase();
  if (body.length !== PAYLOAD_CHARS) {
    throw new Error(
      `fleet code body must be ${PAYLOAD_CHARS} base32 chars (got ${body.length})`,
    );
  }
  const decoded = base32Decode(body);
  const secret = decoded.subarray(0, SECRET_BYTES);
  // Checksum bits live in the top of byte[16] (see encodeFleetCode).
  const checkByte = (decoded[SECRET_BYTES] >>> 6) & 0x03;
  const expected = createHash("sha256").update(secret).digest()[0] & 0x03;
  if (checkByte !== expected) {
    throw new Error("fleet code checksum mismatch — please re-type carefully");
  }
  return Buffer.from(secret);
}

function groupBy4(s: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < s.length; i += 4) groups.push(s.slice(i, i + 4));
  return groups;
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(s: string): Buffer {
  const normalized = s
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/L/g, "1")
    .replace(/U/g, "V");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of normalized) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) throw new Error(`invalid fleet code character: ${c}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // Emit the trailing partial byte (left-justified). Necessary because the
  // checksum bits live in the top bits of byte[SECRET_BYTES] — without this
  // the decoder would silently drop them.
  if (bits > 0) bytes.push((value << (8 - bits)) & 0xff);
  return Buffer.from(bytes);
}

/** Short, base32-encoded device id derived from a public key (first 60 bits). */
export function shortDeviceId(publicKeyHex: string): string {
  const buf = Buffer.from(publicKeyHex, "hex");
  // 60 bits = 12 base32 chars; plenty to disambiguate ~3 devices.
  return base32Encode(buf).slice(0, 12).match(/.{1,4}/g)!.join("-");
}
