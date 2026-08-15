import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { env } from "../config.js";
import type { RpcCrossCheck } from "../types.js";

const client = createPublicClient({
  chain: base,
  transport: http(env.baseRpcUrl),
});

// Uniswap V2-style pair interface — also implemented by the V2 forks common on Base
// (Aerodrome's basic pools, BaseSwap, etc). Confirm a given pool actually exposes this
// before relying on it; concentrated-liquidity pools (V3-style) need a different ABI.
const PAIR_ABI = [
  {
    inputs: [],
    name: "getReserves",
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Reads live reserves directly from the pool contract at the moment a divergence
 * event fires. This is the one point in the pipeline that goes straight to the chain
 * instead of through an indexer — used to cross-check DexScreener's reported liquidity
 * against contract truth, not to replace DexScreener for routine polling.
 *
 * Converting raw reserves into a USD delta requires knowing which side of the pool is
 * the quote asset and its decimals, which varies per pool — that mapping isn't hard-coded
 * here, so deltaPct is left null until you wire up per-token decimals in the watchlist.
 */
export async function fetchRpcCrossCheck(
  poolAddress: `0x${string}`,
  dexscreenerLiquidityUsd: number | null
): Promise<RpcCrossCheck> {
  const [reserve0, reserve1] = await client.readContract({
    address: poolAddress,
    abi: PAIR_ABI,
    functionName: "getReserves",
  });

  const blockNumber = await client.getBlockNumber();

  return {
    reserve0: reserve0.toString(),
    reserve1: reserve1.toString(),
    blockNumber: blockNumber.toString(),
    dexscreenerLiquidityUsd,
    deltaPct: null,
  };
}
