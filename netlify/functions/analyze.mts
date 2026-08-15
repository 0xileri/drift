/**
 * GET /api/analyze?symbol=AERO
 *
 * Returns the divergence reading without narration. Narration is a second request
 * (/api/narrate) because the two together run 7-9s against a 10s function limit, which leaves no
 * margin for a slow upstream. Split, each phase has real headroom and the UI can show scores
 * immediately instead of waiting on prose.
 */
import type { Config } from "@netlify/functions";
import { toLambda } from "./_lambda.js";
import { analyzeToken, LookupError, normaliseSymbol } from "../../src/lookup.js";
import { sign } from "../../src/sign.js";

/**
 * Per-instance, best-effort rate limit. Serverless instances are not shared, so this is a
 * speed bump rather than a guarantee - the real protection is the CDN cache below, which makes
 * repeat lookups of the same ticker free.
 */
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear(); // bound memory on a long-lived instance
  return recent.length > RATE_LIMIT;
}

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

class Busy extends Error {}

/** Resolves the work, or rejects with Busy once the budget is spent. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Busy()), ms)),
  ]);
}

const analyzeFn = async (req: Request, context: { ip?: string }) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("symbol") ?? "";

  let symbol: string;
  try {
    symbol = normaliseSymbol(raw);
  } catch (err) {
    return json({ error: (err as Error).message, code: "BAD_SYMBOL" }, 400);
  }

  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) {
    return json(
      { error: "Too many lookups. Wait a minute and try again.", code: "RATE_LIMITED" },
      429,
      { "retry-after": "60" }
    );
  }

  try {
    // A cold instance makes its provider calls immediately, so the common case is ~5s. Under
    // concurrent load the provider throttles queue instead - LunarCrush allows 10 req/min, and
    // exceeding it drops connections rather than returning 429, so the spacing cannot be tuned
    // away. Better to say "busy, retry" at 8s than to be killed at 10 with no response at all.
    const r = await withDeadline(analyzeToken(symbol, { narrate: false }), 8000);

    return json(
      {
        symbol: r.symbol,
        pool: r.pool,
        hoursJoined: r.hoursJoined,
        bucketMs: r.bucketMs,
        divergence: r.divergence,
        series: r.series,
        // Lets /api/narrate trust these numbers came from the engine, not from a caller.
        // The snapshot rides along because the narrator reads sentiment and volume for context -
        // without them the explanation degrades to restating the score back at the reader.
        token: sign({
          symbol: r.symbol,
          bucketMs: r.bucketMs,
          divergence: r.divergence,
          snapshot: r.latest,
        }),
      },
      200,
      {
        // Readings are keyed to a closed hourly bucket, so they are stable until the next hour.
        // Caching at the edge is what keeps a public endpoint from becoming a bill.
        "cache-control": "public, max-age=60, s-maxage=900, stale-while-revalidate=3600",
      }
    );
  } catch (err) {
    if (err instanceof Busy) {
      return json(
        { error: "Busy right now - the data providers are rate limited. Try again shortly.", code: "BUSY" },
        503,
        { "retry-after": "15" }
      );
    }
    if (err instanceof LookupError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    console.error("analyze failed", err);
    return json({ error: "Analysis failed unexpectedly.", code: "INTERNAL" }, 500);
  }
};

// Both exports on purpose: `handler` is what the uploaded-bundle runtime calls, `default`
// plus `config` is what Netlify's own build uses. Keeping both means the same source works
// whether this deploys via the API or via Git integration.
export const handler = toLambda(analyzeFn);

export default analyzeFn;

export const config: Config = { path: "/api/analyze" };
