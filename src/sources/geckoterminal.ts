/**
 * GeckoTerminal OHLCV — the onchain momentum source.
 *
 * Chosen over DexScreener for the momentum metric because it returns HISTORY (verified: 1000
 * hourly points, ~41 days) for a specific Base pool. That lets the divergence engine's baseline
 * be backfilled instead of accumulated by polling for weeks, and keeps the signal pool-specific
 * rather than aggregate cross-venue volume.
 *
 * Free, no API key. Docs: https://www.geckoterminal.com/dex-api
 */

import { createThrottle, fetchWithRetry } from "./http.js";

/**
 * GeckoTerminal's free tier allows roughly 30 calls/min. 2s spacing stays under that while
 * letting a five-token poll cycle finish in about ten seconds.
 */
const throttle = createThrottle(Number(process.env.GECKOTERMINAL_MIN_INTERVAL_MS ?? 2000));

export interface PoolBar {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

interface OhlcvResponse {
  data?: {
    attributes?: {
      // [unix_seconds, open, high, low, close, volume]
      ohlcv_list?: Array<[number, number, number, number, number, number]>;
    };
  };
}

/**
 * Returns hourly bars for a Base pool, oldest-first.
 * `limit` maxes out at 1000 per GeckoTerminal.
 */
export async function fetchPoolHistory(poolAddress: string, limit = 1000): Promise<PoolBar[]> {
  const url = new URL(
    `https://api.geckoterminal.com/api/v2/networks/base/pools/${poolAddress}/ohlcv/hour`
  );
  url.searchParams.set("aggregate", "1");
  url.searchParams.set("limit", String(Math.min(limit, 1000)));

  const res = await throttle(() =>
    fetchWithRetry(url, {
      init: { headers: { Accept: "application/json" } },
      onRetry: (attempt, wait, reason) =>
        console.log(`    [geckoterminal] retry ${attempt} in ${wait / 1000}s (${reason})`),
    })
  );
  if (!res.ok) {
    throw new Error(`GeckoTerminal OHLCV request failed (${res.status}) for pool ${poolAddress}`);
  }

  const data = (await res.json()) as OhlcvResponse;
  const list = data.data?.attributes?.ohlcv_list ?? [];

  // API returns newest-first; the engine expects oldest-first.
  return list
    .map(([seconds, open, high, low, close, volume]) => ({
      timestampMs: seconds * 1000,
      open,
      high,
      low,
      close,
      volumeUsd: volume,
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export interface PoolMatch {
  address: string;
  name: string;
  liquidityUsd: number;
  volume24hUsd: number;
}

interface SearchResponse {
  data?: Array<{
    attributes?: {
      address?: string;
      name?: string;
      reserve_in_usd?: string;
      volume_usd?: { h24?: string };
    };
  }>;
}

/**
 * Finds the deepest Base pool whose name matches a ticker.
 *
 * IMPORTANT: matching is by symbol, which does NOT establish token identity - anyone can deploy a
 * token with any ticker. Liquidity is used as the ranking heuristic because an impostor rarely
 * outweighs the real market, but callers must surface the chosen pool address so a reader can
 * verify it themselves rather than trusting the match.
 */
export async function findTopPool(symbol: string): Promise<PoolMatch | null> {
  const url = new URL("https://api.geckoterminal.com/api/v2/search/pools");
  url.searchParams.set("query", symbol);
  url.searchParams.set("network", "base");

  const res = await throttle(() =>
    fetchWithRetry(url, { init: { headers: { Accept: "application/json" } } })
  );
  if (!res.ok) throw new Error(`GeckoTerminal pool search failed (${res.status}) for ${symbol}`);

  const body = (await res.json()) as SearchResponse;
  const upper = symbol.toUpperCase();

  const pools = (body.data ?? [])
    .map((p) => p.attributes)
    .filter((a): a is NonNullable<typeof a> => Boolean(a?.address && a?.name))
    // The API returns loose matches ("AERODROME-X / WETH" for "AERO"), so require the ticker to
    // appear as a whole token in the pair name rather than as a substring of a longer symbol.
    .filter((a) =>
      a
        .name!.split("/")
        .map((side) => side.trim().split(/\s+/)[0].toUpperCase())
        .includes(upper)
    )
    .sort((a, b) => Number(b.reserve_in_usd ?? 0) - Number(a.reserve_in_usd ?? 0));

  const best = pools[0];
  if (!best) return null;

  return {
    address: best.address!,
    name: best.name!,
    liquidityUsd: Number(best.reserve_in_usd ?? 0),
    volume24hUsd: Number(best.volume_usd?.h24 ?? 0),
  };
}

/**
 * Most recent CLOSED hourly bar. Skips the in-progress hour, whose volume is still accumulating
 * and would otherwise register as a volume collapse followed by a spike on the next poll.
 */
export async function fetchLatestBar(poolAddress: string): Promise<PoolBar | null> {
  const bars = await fetchPoolHistory(poolAddress, 3);
  const currentHourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const closed = bars.filter((b) => b.timestampMs < currentHourStart);
  return closed[closed.length - 1] ?? null;
}
