/**
 * Finds candidate Base pools for each symbol and tests whether the RPC cross-check works on them.
 *
 * Two things this checks that aren't obvious from a DexScreener page:
 *   1. OHLCV depth -” a pool needs enough hourly bars to join against ~740 hours of social data.
 *   2. getReserves() support -” the RPC cross-check assumes a Uniswap V2-style pair. Concentrated
 *      liquidity (V3-style) pools revert on that call, so they'd break the verification step.
 *
 * IDENTITY IS NOT VERIFIED HERE. Symbol search returns impostor tokens as readily as real ones.
 * Treat this output as candidates to check on BaseScan and the project's own official links -”
 * never paste an address straight into config from this list.
 *
 *   npm run find:pools
 */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { fetchPoolHistory } from "../src/sources/geckoterminal.js";

const SYMBOLS = ["AERO", "BRETT", "DEGEN", "TOSHI", "VIRTUAL", "MORPHO", "KEYCAT", "AVNT", "BNKR"];

const rpc = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

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

interface SearchPool {
  attributes?: {
    address?: string;
    name?: string;
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries on 429 rather than reporting a rate limit as "no pool exists". */
async function searchWithRetry(url: URL, attempts = 4): Promise<Response> {
  let res = await fetch(url, { headers: { Accept: "application/json" } });
  for (let i = 1; i < attempts && res.status === 429; i++) {
    const wait = 5000 * i;
    console.log(`    rate limited, waiting ${wait / 1000}s...`);
    await sleep(wait);
    res = await fetch(url, { headers: { Accept: "application/json" } });
  }
  return res;
}

async function topPoolFor(symbol: string): Promise<SearchPool["attributes"] | null> {
  const url = new URL("https://api.geckoterminal.com/api/v2/search/pools");
  url.searchParams.set("query", symbol);
  url.searchParams.set("network", "base");

  const res = await searchWithRetry(url);
  if (!res.ok) {
    // Surface it: a swallowed 429 looks identical to a token that has no pool.
    throw new Error(`search HTTP ${res.status}`);
  }

  const body = (await res.json()) as { data?: SearchPool[] };
  const pools = (body.data ?? [])
    .map((p) => p.attributes)
    .filter((a): a is NonNullable<typeof a> => !!a?.address)
    .sort((a, b) => Number(b.reserve_in_usd ?? 0) - Number(a.reserve_in_usd ?? 0));

  return pools[0] ?? null;
}

async function supportsGetReserves(address: string): Promise<boolean> {
  try {
    await rpc.readContract({
      address: address as `0x${string}`,
      abi: PAIR_ABI,
      functionName: "getReserves",
    });
    return true;
  } catch {
    return false;
  }
}

const rows: Record<string, unknown>[] = [];

for (const [i, symbol] of SYMBOLS.entries()) {
  if (i > 0) await sleep(4000);

  let pool: SearchPool["attributes"] | null = null;
  try {
    pool = await topPoolFor(symbol);
  } catch (err) {
    rows.push({ symbol, poolName: `SEARCH FAILED: ${(err as Error).message}` });
    console.log(`  ${symbol}: search failed -” ${(err as Error).message}`);
    continue;
  }

  if (!pool?.address) {
    rows.push({ symbol, poolName: "no pool in results" });
    console.log(`  ${symbol}: no pool in results`);
    continue;
  }

  await sleep(1500);

  let bars: number | string = 0;
  try {
    bars = (await fetchPoolHistory(pool.address, 1000)).length;
  } catch (err) {
    bars = `ERR ${(err as Error).message.match(/\((\d+)\)/)?.[1] ?? "?"}`;
  }

  const v2 = await supportsGetReserves(pool.address);

  rows.push({
    symbol,
    poolName: pool.name ?? "?",
    address: pool.address,
    liquidityUsd: Math.round(Number(pool.reserve_in_usd ?? 0)).toLocaleString(),
    vol24hUsd: Math.round(Number(pool.volume_usd?.h24 ?? 0)).toLocaleString(),
    bars,
    getReserves: v2 ? "YES (v2)" : "no (v3?)",
  });
  console.log(`  ${symbol}: ${pool.name} -” ${bars} bars, getReserves ${v2 ? "yes" : "no"}`);
}

console.log("\n" + "=".repeat(100));
console.table(rows);
console.log(
  "\nVERIFY EVERY ADDRESS on BaseScan and against the project's official links before adding it\n" +
    "to src/config.ts. Symbol search does not prove token identity.\n" +
    "Pools without getReserves still work for divergence -” only the RPC cross-check needs a v2 pair."
);

