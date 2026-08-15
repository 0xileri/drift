import { env } from "../config.js";
import { isTransient, sleep } from "./http.js";
import type { SocialSnapshot } from "../types.js";

/**
 * Time-series data point. The social fields (interactions, sentiment, contributors, posts)
 * live ONLY on this endpoint — the simpler /coins/:coin/v1 endpoint returns market data plus
 * galaxy_score/alt_rank, but no sentiment or social volume. Confirmed against
 * https://github.com/lunarcrush/api
 */
interface TimeSeriesPoint {
  time: number;
  interactions?: number;
  contributors_active?: number;
  posts_created?: number;
  posts_active?: number;
  sentiment?: number;
  spam?: number;
  galaxy_score?: number;
  alt_rank?: number;
  social_dominance?: number;
}

interface TimeSeriesResponse {
  data?: TimeSeriesPoint[];
}

/**
 * Minimum spacing between LunarCrush requests.
 *
 * The Individual tier allows 10 req/min. Exceeding it does NOT reliably return HTTP 429 — the
 * edge starts dropping connections, which surfaces as UND_ERR_CONNECT_TIMEOUT and looks exactly
 * like the host being down. 7s spacing keeps us under the ceiling with headroom.
 * Raise LUNARCRUSH_MIN_INTERVAL_MS if you're on a busier plan sharing the key.
 */
const MIN_INTERVAL_MS = Number(process.env.LUNARCRUSH_MIN_INTERVAL_MS ?? 7000);

/**
 * Whether to wait out a rate limit or give up immediately.
 *
 * A batch job has twenty minutes and should absolutely wait - backing off hard is the only thing
 * that clears a tripped limiter. An interactive request has ten seconds total, so a 20s backoff
 * cannot help it; the request is already dead by the time the retry fires. Fail-fast lets the
 * caller return "busy, try again" while the response still means something.
 */
const FAST_FAIL = process.env.HTTP_FAST_FAIL === "1";
const RETRY_ATTEMPTS = FAST_FAIL ? 1 : 4;

let lastRequestAt = 0;
/** Serialises requests so concurrent callers can't bypass the spacing. */
let queue: Promise<unknown> = Promise.resolve();

// Fault classification lives in ./http.ts, shared with the GeckoTerminal client. This module
// keeps its own retry loop rather than using fetchWithRetry because it must hold the throttle
// queue and re-apply request spacing between attempts.

/**
 * Throttled, retrying fetch. Backs off hard on connection drops because those indicate the rate
 * limiter is already unhappy — retrying fast makes it worse.
 */
async function throttledFetch(url: string | URL, attempts = RETRY_ATTEMPTS): Promise<Response> {
  const run = async (): Promise<Response> => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const since = Date.now() - lastRequestAt;
      if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);

      try {
        lastRequestAt = Date.now();
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${env.lunarcrushApiKey}` },
        });

        if ((res.status === 429 || res.status >= 500) && attempt < attempts - 1) {
          const retryAfter = Number(res.headers.get("retry-after")) || 0;
          const wait = Math.max(retryAfter * 1000, 15_000 * (attempt + 1));
          console.log(`    [lunarcrush] retry ${attempt + 1} in ${wait / 1000}s (HTTP ${res.status})`);
          await sleep(wait);
          continue;
        }
        return res;
      } catch (err) {
        if (!isTransient(err) || attempt === attempts - 1) throw err;
        const wait = 20_000 * (attempt + 1);
        const reason =
          (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error).message.slice(0, 40);
        console.log(`    [lunarcrush] retry ${attempt + 1} in ${wait / 1000}s (${reason})`);
        await sleep(wait);
      }
    }
    throw new Error("unreachable");
  };

  const result = queue.then(run, run);
  // Keep the chain alive regardless of outcome so one failure doesn't wedge the queue.
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function toSnapshot(point: TimeSeriesPoint): SocialSnapshot {
  return {
    galaxyScore: point.galaxy_score ?? null,
    altRank: point.alt_rank ?? null,
    sentiment: point.sentiment ?? null,
    socialVolume: point.interactions ?? null,
  };
}

/**
 * Fetches recent social metrics for a coin from LunarCrush v4 time-series.
 *
 * NOTE ON PLAN TIERS: LunarCrush has no free API tier. The cheapest plan (Individual, $5/day)
 * is documented as "limited endpoints"; Builder ($15/day) is "all endpoints". Whether this
 * time-series endpoint is included at the Individual tier is not stated in the public docs —
 * verify against your own key before assuming the cheap plan is enough.
 */
export async function fetchSocialSnapshot(symbol: string): Promise<SocialSnapshot> {
  const points = await fetchSocialHistory(symbol, "1w", "hour");
  const complete = dropIncompleteBucket(points);
  const latest = complete[complete.length - 1];

  if (!latest) {
    return { galaxyScore: null, altRank: null, sentiment: null, socialVolume: null };
  }

  return latest.social;
}

/**
 * Drops the still-accumulating current hour.
 *
 * The newest bucket covers an hour that hasn't finished, so its `interactions` total is partial —
 * feeding it to the engine reads as a collapse in social activity followed by a spike when the
 * hour closes, which is an artifact, not a signal. (It's also why the newest point can carry
 * `interactions` while `galaxy_score` is still null: the derived scores haven't been computed
 * for it yet.)
 */
export function dropIncompleteBucket<T extends { timestampMs: number }>(points: T[]): T[] {
  const currentHourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  return points.filter((p) => p.timestampMs < currentHourStart);
}

/**
 * Pulls a window of historical social data points, oldest-first.
 *
 * This is what makes a backtest possible instead of a live-only demo: rather than polling for
 * weeks to accumulate history, the divergence engine's baseline can be seeded from real past
 * data. See scripts/backfill.ts.
 */
export async function fetchSocialHistory(
  symbol: string,
  interval: string = "1m",
  bucket: "hour" | "day" = "hour"
): Promise<Array<{ timestampMs: number; social: SocialSnapshot }>> {
  const url = new URL(`https://lunarcrush.com/api4/public/coins/${symbol}/time-series/v2`);
  url.searchParams.set("bucket", bucket);
  url.searchParams.set("interval", interval);

  const res = await throttledFetch(url);

  if (!res.ok) {
    throw new Error(
      `LunarCrush time-series request failed (${res.status}) for ${symbol}` +
        (res.status === 403 || res.status === 401
          ? " - this may mean your plan tier does not include this endpoint."
          : "")
    );
  }

  const data = (await res.json()) as TimeSeriesResponse;

  return (data.data ?? []).map((point) => ({
    timestampMs: point.time * 1000,
    social: toSnapshot(point),
  }));
}
