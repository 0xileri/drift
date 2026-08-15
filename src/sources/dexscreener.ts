import type { OnchainSnapshot } from "../types.js";

interface DexScreenerPairResponse {
  pairs: Array<{
    priceUsd: string;
    liquidity?: { usd?: number };
    volume?: { h24?: number };
    txns?: { h24?: { buys?: number; sells?: number } };
  }> | null;
}

/**
 * Pulls price/volume/liquidity/txn count for a Base pair from DexScreener's public API.
 * No API key required. https://docs.dexscreener.com/api/reference
 */
export async function fetchOnchainSnapshot(pairAddress: string): Promise<OnchainSnapshot> {
  const url = `https://api.dexscreener.com/latest/dex/pairs/base/${pairAddress}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`DexScreener request failed (${res.status}) for pair ${pairAddress}`);
  }

  const data = (await res.json()) as DexScreenerPairResponse;
  const pair = data.pairs?.[0];
  if (!pair) {
    return {
      priceUsd: null,
      intervalVolumeUsd: null,
      volume24hUsd: null,
      liquidityUsd: null,
      txns24h: null,
    };
  }

  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;

  return {
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    // Left null on purpose: the interval metric comes from GeckoTerminal so backfilled and live
    // snapshots stay comparable. The runner fills it in.
    intervalVolumeUsd: null,
    volume24hUsd: pair.volume?.h24 ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    txns24h: buys + sells,
  };
}
