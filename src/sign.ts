/**
 * Signs the analysis payload handed between the two lookup endpoints.
 *
 * The narration endpoint must not accept arbitrary numbers from a caller: the prompt is fixed,
 * but the values inside it are not, and an open endpoint would let anyone spend the project's
 * Anthropic credit on figures the engine never produced. Signing means /api/narrate only ever
 * narrates a reading that /api/analyze actually computed.
 *
 * The secret is derived from an existing server-side key rather than adding another required
 * env var - one more secret to configure is one more way for a deploy to be silently broken.
 * Override with LOOKUP_SIGNING_SECRET if you'd rather keep the concerns separate.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Signatures expire so a captured token can't be replayed indefinitely. */
const MAX_AGE_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.LOOKUP_SIGNING_SECRET || process.env.ANTHROPIC_API_KEY;
  if (!s) throw new Error("No signing secret available (set LOOKUP_SIGNING_SECRET).");
  return s;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function sign<T>(payload: T): string {
  const body = b64url(Buffer.from(JSON.stringify({ p: payload, t: Date.now() })));
  const mac = b64url(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${mac}`;
}

export function verify<T>(token: unknown): T {
  if (typeof token !== "string" || token.length > 20_000) {
    throw new Error("Malformed token.");
  }

  const [body, mac] = token.split(".");
  if (!body || !mac) throw new Error("Malformed token.");

  const expected = createHmac("sha256", secret()).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    throw new Error("Malformed token.");
  }

  // Length must match before timingSafeEqual, which throws on mismatched buffers.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error("Bad signature.");
  }

  const decoded = JSON.parse(Buffer.from(body, "base64url").toString()) as { p: T; t: number };
  if (!decoded || typeof decoded.t !== "number" || Date.now() - decoded.t > MAX_AGE_MS) {
    throw new Error("Token expired.");
  }

  return decoded.p;
}
