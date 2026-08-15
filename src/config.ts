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
 * Calibrated against 3,402 hours of real two-axis history across the five watched tokens
 * (`npm run calibrate -- --watchlist`). Pooled fire rates:
 *
 *   4.0 -> 8.8% of hours  (~10.6 events/day across the watchlist)
 *   5.0 -> 4.7%           (~5.6/day)
 *   6.0 -> 2.8%           (~3.3/day)   <- chosen
 *   7.0 -> 1.4%           (~1.7/day)
 *
 * 6.0 keeps the feed readable — a few events a day is enough to look alive without becoming
 * wallpaper — and each event costs an Anthropic call, so the rate is a real cost too.
 *
 * Note this is far above the 3.5 that the onchain-only calibration suggested: real social
 * movement roughly doubles the spread. Re-run the calibration if the watchlist changes.
 *
 * KNOWN LIMITATION: a single global threshold does not treat the tokens equally. BNKR is
 * materially calmer than the rest (6.9% of hours above 3.5, against 13-14% for the other four),
 * so at any shared cutoff it stays quieter than its peers - that is a property of the token, not
 * of its signal quality. If the feed looks lopsided, per-token thresholds derived from each
 * token's own distribution are the honest fix.
 */
export const DIVERGENCE_THRESHOLD = 6.0;

export const HISTORY_DIR = new URL("../data/history/", import.meta.url);
export const FEED_PATH = new URL("../data/feed.json", import.meta.url);
