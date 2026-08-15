/**
 * POST /api/narrate   { token }
 *
 * Second half of the lookup. Takes the signed reading from /api/analyze and returns the
 * explanation. Only a token this project signed is accepted, so the endpoint can never be used
 * to run arbitrary text through the project's Anthropic key.
 */
import type { Config } from "@netlify/functions";
import { toLambda } from "./_lambda.js";
import { verify } from "../../src/sign.js";
import { narrateDivergence } from "../../src/narration/narrate.js";
import type { DivergenceResult, PollSnapshot } from "../../src/types.js";

const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > RATE_LIMIT;
}

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

interface Signed {
  symbol: string;
  bucketMs: number;
  divergence: DivergenceResult;
  snapshot: PollSnapshot;
}

const narrateFn = async (req: Request, context: { ip?: string }) => {
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) {
    return json({ error: "Too many requests. Wait a minute.", code: "RATE_LIMITED" }, 429, {
      "retry-after": "60",
    });
  }

  let payload: Signed;
  try {
    const body = (await req.json()) as { token?: unknown };
    payload = verify<Signed>(body?.token);
  } catch (err) {
    return json({ error: (err as Error).message, code: "BAD_TOKEN" }, 400);
  }

  try {
    // The snapshot came through the signature, so these are the engine's own figures rather
    // than anything a caller supplied. rpcCrossCheck stays null and that is honest: this path
    // never made the call, and fabricating one would claim a verification that did not happen.
    const narration = await narrateDivergence(payload.snapshot, payload.divergence, null);
    return json({ narration }, 200, {
      "cache-control": "public, max-age=60, s-maxage=900",
    });
  } catch (err) {
    console.error("narrate failed", err);
    return json({ error: "Narration failed.", code: "INTERNAL" }, 500);
  }
};

// Both exports on purpose - see analyze.mts.
export const handler = toLambda(narrateFn);

export default narrateFn;

export const config: Config = { path: "/api/narrate" };
