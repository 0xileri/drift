export interface WatchedToken {
  /** Ticker used for display and LunarCrush lookups, e.g. "AERO" */
  symbol: string;
  /** LunarCrush coin identifier — usually the same as symbol, override if it diverges */
  lunarcrushSymbol?: string;
  /**
   * ERC-20 token address on Base. Optional: nothing reads it today, and leaving it blank is
   * better than recording an address that hasn't been verified against the project's own links.
   */
  baseTokenAddress?: `0x${string}`;
  /** DexScreener pair address on Base (token/WETH or token/USDC pool) used for price/volume/liquidity */
  dexscreenerPairAddress: string;
  /**
   * Pool contract address used for the direct Base RPC cross-check (getReserves).
   * Usually the same pool as dexscreenerPairAddress. Omit to skip the RPC check for this token.
   */
  rpcPoolAddress?: `0x${string}`;
}

export interface SocialSnapshot {
  galaxyScore: number | null;
  altRank: number | null;
  sentiment: number | null;
  socialVolume: number | null;
}

export interface OnchainSnapshot {
  priceUsd: number | null;
  /**
   * Volume for ONE bucket interval (hourly), from GeckoTerminal OHLCV.
   * This is the metric the divergence engine reads, and it must mean the same thing whether
   * the snapshot came from backfill or live polling — do not substitute a rolling 24h figure.
   */
  intervalVolumeUsd: number | null;
  /** Rolling 24h context from DexScreener. Narration/context only — NOT fed into the z-score. */
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  txns24h: number | null;
}

export interface RpcCrossCheck {
  reserve0: string;
  reserve1: string;
  blockNumber: string;
  dexscreenerLiquidityUsd: number | null;
  /** Absolute % difference between DexScreener's reported liquidity and what the pool reserves imply, when computable */
  deltaPct: number | null;
}

export interface PollSnapshot {
  token: string;
  timestampMs: number;
  social: SocialSnapshot;
  onchain: OnchainSnapshot;
}

export interface DivergenceResult {
  token: string;
  timestampMs: number;
  sufficientHistory: boolean;
  /**
   * Momentum as a natural-log ratio between consecutive intervals, NOT a percentage.
   * 0 = flat, +0.69 = doubled, -0.69 = halved. Anything consuming these (including the
   * narration prompt) must not present them as percent change.
   */
  socialMomentumLogRatio: number | null;
  onchainMomentumLogRatio: number | null;
  socialZ: number | null;
  onchainZ: number | null;
  /**
   * Which series drove the gap and which way it moved.
   *
   * The sign of divergenceScore cannot express this on its own: in 30% of recorded events both
   * series moved the SAME direction and the gap was one falling faster than the other. A
   * two-label scheme reported those as "onchain ahead" while the narration underneath described
   * both contracting, which is a visible contradiction.
   */
  direction:
    | "social-rising"
    | "social-falling"
    | "onchain-rising"
    | "onchain-falling"
    | null;
  /**
   * Set when the reading is arithmetically valid but not trustworthy - currently only when an
   * interval's volume is too small for its ratio to carry information. Suppressed readings never
   * become events.
   */
  suppressedReason: string | null;
  /** socialZ - onchainZ. Positive = social running hotter than onchain. Negative = onchain moving ahead of social. */
  divergenceScore: number | null;
  significant: boolean;
}

export interface FeedEvent {
  token: string;
  timestampMs: number;
  divergence: DivergenceResult;
  rpcCrossCheck: RpcCrossCheck | null;
  narration: string;
  /**
   * True when the event was found by replaying recorded history rather than by a live poll at
   * the time it describes. Real engine output over real data either way, but the distinction is
   * shown in the feed so a reader is never misled about when the agent actually saw it.
   */
  backfilled?: boolean;
}
