import "dotenv/config";
import type { WatchedToken } from "./types.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * Resolved lazily so a script only fails on the keys it actually uses — backfill and the
 * screening/calibration tools have no reason to demand an Anthropic key.
 */
export const env = {
  get lunarcrushApiKey() {
    return requireEnv("LUNARCRUSH_API_KEY");
  },
  get anthropicApiKey() {
    return requireEnv("ANTHROPIC_API_KEY");
  },
  get baseRpcUrl() {
    return process.env.BASE_RPC_URL || "https://mainnet.base.org";
  },
};

/**
 * Tokens the agent monitors. Fill these in with addresses you've verified yourself
 * (DexScreener page URL gives you both the token and pair address; BaseScan confirms
 * the contract). Do not trust addresses from chat, social posts, or search results —
 * verify against the project's own official links before adding a token here.
 */
/**
 * Screened via `npm run screen` (social coverage) and `npm run find:pools` + `npm run depth`
 * (pool depth and getReserves support). Every entry has 100% hourly social coverage over ~740
 * hours, interactions that actually vary, and 1000 hourly bars with no zero-volume gaps.
 *
 * ADDRESSES ARE UNVERIFIED CANDIDATES. They came from GeckoTerminal symbol search, which does
 * not prove token identity — an impostor token with a similar ticker can appear in results.
 * Check each against BaseScan and the project's own official links before trusting output.
 * The large-liquidity entries are low-risk; KEYCAT is the one most worth double-checking.
 */
export const watchlist: WatchedToken[] = [
  {
    // Aerodrome — Base's flagship DEX. $26.5M pool, gap-free history, v2 pair so the
    // RPC cross-check works. The anchor token.
    symbol: "AERO",
    dexscreenerPairAddress: "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
    rpcPoolAddress: "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
  },
  {
    // $4.2M pool, v2 pair. ~159 hours missing from OHLCV, so expect a shorter joined series.
    symbol: "VIRTUAL",
    dexscreenerPairAddress: "0x21594b992f68495dd28d605834b58889d0a727c7",
    rpcPoolAddress: "0x21594b992f68495dd28d605834b58889d0a727c7",
  },
  {
    // Smallest of the set at $560k — included deliberately as the thin-liquidity case, which is
    // where the log-ratio fix matters most. v2 pair.
    symbol: "KEYCAT",
    dexscreenerPairAddress: "0x377feeed4820b3b28d1ab429509e7a0789824fca",
    rpcPoolAddress: "0x377feeed4820b3b28d1ab429509e7a0789824fca",
  },
  {
    // $1.4M pool, heavy volume, gap-free. Concentrated-liquidity pool: no getReserves, so
    // rpcPoolAddress is omitted and the cross-check is skipped for this token.
    symbol: "MORPHO",
    dexscreenerPairAddress: "0xb5f0b4ae66c14f7efaa9aa1468e8fc536a3e288c",
  },
  {
    // $1.5M pool, gap-free, high volume. Also concentrated-liquidity — no cross-check.
    symbol: "BNKR",
    dexscreenerPairAddress: "0xaec085e5a5ce8d96a7bdd3eb3a62445d4f6ce703",
  },

  // --- Added from the Base-ecosystem screen (npm run screen:base) ---------------------
  //
  // Selected on where the token actually trades, not on market cap. The social feed measures
  // global attention, so pairing it with a Base pool only means something when a real share of
  // the volume is on Base. Bridged majors fail that badly: SHIB, LINK and DOT all sit at
  // 0.0-0.1% of global volume on Base, so their social spikes would be compared against a market
  // that barely exists here.
  //
  // Share-of-volume is a heuristic, not proof. The stricter test is whether Base volume tracks
  // global volume, which needs correlation analysis that has not been run - so these three were
  // picked from the unambiguous end of the range rather than the borderline middle.
  {
    // 36% of global volume on Base, $9.4M pool - the deepest of the additions. v2 pair.
    symbol: "VVV",
    dexscreenerPairAddress: "0x01784ef301d79e4b2df3a21ad9a536d4cf09a5ce",
    rpcPoolAddress: "0x01784ef301d79e4b2df3a21ad9a536d4cf09a5ce",
  },
  {
    // 40% on Base, $6.2M pool, and the highest Base volume in the screen at $12.1M/24h.
    // Concentrated-liquidity pool: no getReserves, so no cross-check.
    symbol: "VELVET",
    dexscreenerPairAddress: "0x6b0f53cbd9272d8117e9535fe25371dedf39a1be",
  },
  {
    // 58% on Base, the most Base-native of the set. Quoted in VIRTUAL rather than WETH or USDC,
    // which does not affect the engine - momentum is read from the pool's own USD volume.
    // v2 pair.
    symbol: "TIBBIR",
    dexscreenerPairAddress: "0x0c3b466104545efa096b8f944c1e524e1d0d4888",
    rpcPoolAddress: "0x0c3b466104545efa096b8f944c1e524e1d0d4888",
  },
];

/**
 * Minimum snapshots before z-scores are treated as meaningful.
 *
 * 24 = one full day of hourly buckets. The engine uses median/MAD, and a median over a handful
 * of points is unstable enough to manufacture false signal early in a series. Backfill supplies
 * hundreds of points up front, so there's no reason to run thin.
 */
export const MIN_HISTORY_FOR_ZSCORE = 24;

/**
 * Absolute divergence gap above which an event is worth narrating.
 *
 * PROVISIONAL, and deliberately not described as "measured". It is a RATE target: at 2.5 the
 * feed runs ~1.6 events/day across the watchlist, which is readable. Nothing here establishes
 * that events above 2.5 are more often *right* - that requires knowing what followed them, which
 * is what `npm run scorecard` measures. Once enough outcomes have resolved, pick this on
 * precision and this comment can stop hedging.
 *
 * The scale changed when the two axes were put on a common footing (see tailScale in
 * engine/divergence.ts). Scores now run median 0.58 / p90 1.72 / p99 3.55 / max 5.69, so the
 * previous 6.0 is unreachable by construction rather than merely strict.
 *
 * Pooled rates over 3,297 scored hours, excluding volume-suppressed readings:
 *
 *   2.0 -> 98 events (~3.3/day)   14% onchain-driven
 *   2.5 -> 48 events (~1.6/day)   10% onchain-driven   <- chosen
 *   3.0 -> 26 events (~0.9/day)    8% onchain-driven
 *   4.0 ->  8 events (~0.3/day)    0% onchain-driven
 *
 * The onchain-driven share is worth watching as much as the count: before the axes were put on
 * a common scale it was 0% at every cutoff, which was an artifact of the metric rather than a
 * fact about Base tokens. A threshold that drives it back to zero has reintroduced the bug.
 *
 * KNOWN LIMITATION: one global threshold does not treat the tokens equally - a calmer token
 * stays quieter at any shared cutoff. Per-token thresholds from each token's own distribution
 * are the honest fix if the feed looks lopsided.
 */
export const DIVERGENCE_THRESHOLD = 2.5;

/**
 * Floor below which an hour's volume is too small for its ratio to mean anything.
 *
 * Log-ratio momentum removed the unbounded blow-ups but not the underlying problem: a ratio
 * between two tiny numbers is still noise wearing a plausible score. In the recorded feed, 62%
 * of events had an hour under $1,000 - including $3,953 -> $0.01 scoring 6.17, and
 * $21.73 -> $17,952 scoring 7.55.
 *
 * The floor is RELATIVE because the watchlist spans two orders of magnitude: median hourly
 * volume is $43,214 for AERO and $347 for BNKR. A flat $1,000 cut would drop 3% of MORPHO's
 * hours and 68% of KEYCAT's, deleting precisely the thin-liquidity tokens the agent exists to
 * watch. Scaling to each token's own median asks whether an hour is small *for this pool*,
 * rather than small in dollars.
 *
 * The absolute floor catches the degenerate end, where a fraction of an already-tiny median is
 * itself meaningless.
 */
export const MIN_INTERVAL_VOLUME_USD = 50;
export const MIN_INTERVAL_VOLUME_FRACTION = 0.02;

export const HISTORY_DIR = new URL("../data/history/", import.meta.url);
export const FEED_PATH = new URL("../data/feed.json", import.meta.url);
