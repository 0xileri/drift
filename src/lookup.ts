/**
 * On-demand analysis: given a ticker, produce a divergence reading for it right now.
 *
 * Shared by the CLI (scripts/try-lookup.ts) and the HTTP endpoint, so what gets tested locally is
 * the same code that serves requests. The scheduled poller deliberately does NOT use this - it
 * reads the curated watchlist, where the pool address was verified by a human rather than guessed
 * from a ticker.
 */
import { MIN_HISTORY_FOR_ZSCORE } from "./config.js";
import { computeDivergence } from "./engine/divergence.js";
import { narrateDivergence } from "./narration/narrate.js";
import { fetchSocialHistory, dropIncompleteBucket } from "./sources/lunarcrush.js";
import { fetchPoolHistory, findTopPool, type PoolMatch } from "./sources/geckoterminal.js";
import type { DivergenceResult, PollSnapshot } from "./types.js";

const HOUR_MS = 3_600_000;
const floorToHour = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS;

/** Points returned for the sparkline. A week reads well without bloating the response. */
const SERIES_POINTS = 168;

/**
 * A month of hourly social data is ~720 points and was the single slowest call in the request.
 * A week still gives the median/MAD baseline far more than the 24 hours it needs, and cuts the
 * payload roughly fourfold. The scheduled poller still backfills a full month - it has the time,
 * an interactive request does not.
 */
const SOCIAL_WINDOW = "1w";

/** Enough bars to cover the week of social data plus slack for gaps, without fetching 1000. */
const POOL_BARS = 300;

export class LookupError extends Error {
  constructor(
    message: string,
    readonly code:
      | "BAD_SYMBOL"
      | "NO_POOL"
      | "NO_SOCIAL"
      | "NO_OVERLAP"
      | "THIN_HISTORY"
      | "UPSTREAM",
    readonly status = 400
  ) {
    super(message);
  }
}

export interface LookupResult {
  symbol: string;
  pool: PoolMatch;
  hoursJoined: number;
  /** The hourly bucket the reading describes, not the time the request was made. */
  bucketMs: number;
  divergence: DivergenceResult;
  series: Array<[number, number, number]>;
  narration: string;
  generatedAtMs: number;
  /** The bucket the reading describes. The narrator reads it for context but never rescores it. */
  latest: PollSnapshot;
}

export function normaliseSymbol(raw: string): string {
  const s = raw.trim().replace(/^\$/, "").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(s)) {
    throw new LookupError(
      "Ticker must be 2-12 letters or digits, like AERO or BRETT.",
      "BAD_SYMBOL"
    );
  }
  return s;
}

export async function analyzeToken(
  rawSymbol: string,
  opts: { narrate?: boolean } = {}
): Promise<LookupResult> {
  const symbol = normaliseSymbol(rawSymbol);

  // The social fetch needs only the ticker, so it starts NOW rather than waiting on the pool
  // search. It is the slowest leg by far, and serialising it behind two GeckoTerminal calls was
  // most of the request budget. Kicked off before the await so the two run concurrently.
  const socialPromise = fetchSocialHistory(symbol, SOCIAL_WINDOW, "hour").catch((err) => {
    throw new LookupError(
      `Social data unavailable for ${symbol}: ${err.message}`,
      "NO_SOCIAL",
      502
    );
  });
  // Prevents an unhandled rejection if the pool search throws first and we never await this.
  socialPromise.catch(() => {});

  const pool = await findTopPool(symbol).catch((err) => {
    throw new LookupError(`Could not reach the pool index: ${err.message}`, "UPSTREAM", 502);
  });
  if (!pool) {
    throw new LookupError(`No Base pool found trading ${symbol}.`, "NO_POOL", 404);
  }

  const [socialRaw, barsRaw] = await Promise.all([
    socialPromise,
    fetchPoolHistory(pool.address, POOL_BARS).catch((err) => {
      throw new LookupError(`Pool history unavailable: ${err.message}`, "UPSTREAM", 502);
    }),
  ]);

  // Both feeds expose the in-progress hour, whose totals are still accumulating. Including it
  // would read as a volume collapse and manufacture a divergence that does not exist.
  const social = dropIncompleteBucket(socialRaw);
  const bars = dropIncompleteBucket(barsRaw);

  if (social.length === 0) {
    throw new LookupError(`No social history for ${symbol}.`, "NO_SOCIAL", 404);
  }

  const socialByHour = new Map(social.map((p) => [floorToHour(p.timestampMs), p.social]));

  const history: PollSnapshot[] = [];
  for (const bar of bars) {
    const hour = floorToHour(bar.timestampMs);
    const s = socialByHour.get(hour);
    if (!s) continue;
    history.push({
      token: symbol,
      timestampMs: hour,
      social: s,
      onchain: {
        priceUsd: bar.close,
        intervalVolumeUsd: bar.volumeUsd,
        volume24hUsd: null,
        liquidityUsd: null,
        txns24h: null,
      },
    });
  }

  if (history.length === 0) {
    throw new LookupError(
      `Found a pool and social data for ${symbol}, but no overlapping hours between them.`,
      "NO_OVERLAP",
      422
    );
  }

  // Below this the median/MAD baseline is unstable enough to invent signal, so refuse rather
  // than return a confident-looking number built on nothing.
  if (history.length < MIN_HISTORY_FOR_ZSCORE + 2) {
    throw new LookupError(
      `Only ${history.length} usable hours for ${symbol}; at least ${MIN_HISTORY_FOR_ZSCORE + 2} ` +
        `are needed before a divergence score means anything.`,
      "THIN_HISTORY",
      422
    );
  }

  const divergence = computeDivergence(symbol, history);
  const latest = history[history.length - 1];

  // Replay the tail so the sparkline shows what the engine saw hour by hour, not a recomputation
  // against the full window (which would let later data leak into earlier points).
  const series: Array<[number, number, number]> = [];
  const start = Math.max(2, history.length - SERIES_POINTS);
  for (let i = start; i <= history.length; i++) {
    const d = computeDivergence(symbol, history.slice(0, i));
    if (d.socialZ === null || d.onchainZ === null) continue;
    series.push([
      history[i - 1].timestampMs,
      Number(d.socialZ.toFixed(3)),
      Number(d.onchainZ.toFixed(3)),
    ]);
  }

  const narration =
    opts.narrate === false
      ? ""
      : await narrateDivergence(latest, divergence, null).catch(
          (err) => `Narration unavailable (${err.message}). The scores above are unaffected.`
        );

  return {
    symbol,
    pool,
    hoursJoined: history.length,
    bucketMs: latest.timestampMs,
    divergence,
    series,
    narration,
    generatedAtMs: Date.now(),
    latest,
  };
}
