/**
 * Screens candidate tickers for whether the divergence method is VALID for them, not merely
 * whether a pool exists.
 *
 * The trap: the social signal is global (all of X, Reddit, YouTube) while the onchain signal is
 * Base only. For a bridged major like LINK or SHIB, whose Base activity is a rounding error
 * against its global market, the two series describe different markets and the engine reports a
 * permanent divergence that is an artifact rather than a signal.
 *
 * Measuring that share correctly means summing volume across ALL of a token's Base pools. An
 * earlier version of this script compared a single pool against global volume and concluded that
 * even AERO was a mismatch - which was false: AERO trades across dozens of Aerodrome pairs, so
 * one pool is never its Base footprint.
 *
 *   npx tsx scripts/screen-base-tokens.ts
 */
import { fetchPoolHistory } from "../src/sources/geckoterminal.js";

const DEFAULT_CANDIDATES = [
  "LINK", "SHIB", "DOT", "MORPHO", "VVV", "CAKE", "VELVET", "AERO", "CRV", "VIRTUAL", "SPX",
  "ZRO", "BONK", "SYRUP", "TRAC", "AWE", "1INCH", "SAND", "FLUID", "KAITO", "ZEN",
  "RSR", "BDX", "TIBBIR", "SOSO", "CYS", "VCNT", "DRV", "COW", "RIF", "RAVE", "BEAM",
];

/**
 * Tickers may be passed as arguments so a rate-limited subset can be rerun on its own. The
 * previous full run lost 14 tokens to 429s, and re-measuring the ones that already resolved
 * only spends the rate limit that caused the problem.
 */
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const CANDIDATES = args.length ? args.map((a) => a.toUpperCase()) : DEFAULT_CANDIDATES;

/**
 * Request spacing. GeckoTerminal's free tier allows ~30/min, and each token costs 2-3 calls, so
 * the default sits close to the ceiling and a burst of searches trips it. --slow doubles every
 * gap, which is the difference between losing half the list and finishing.
 */
const SLOW = process.argv.includes("--slow");
const PACE = SLOW ? 2 : 1;

const MIN_BASE_SHARE = 0.15;
const MIN_LIQUIDITY = 150_000;
const MIN_BARS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PoolAttrs {
  address?: string;
  name?: string;
  reserve_in_usd?: string;
  volume_usd?: { h24?: string };
}

/** Every Base pool matching the ticker, so the token's Base footprint can be summed. */
async function basePools(symbol: string): Promise<PoolAttrs[]> {
  const url = new URL("https://api.geckoterminal.com/api/v2/search/pools");
  url.searchParams.set("query", symbol);
  url.searchParams.set("network", "base");

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`search ${res.status}`);

  const body = (await res.json()) as { data?: Array<{ attributes?: PoolAttrs }> };
  const up = symbol.toUpperCase();

  return (body.data ?? [])
    .map((p) => p.attributes)
    .filter((a): a is PoolAttrs => Boolean(a?.address && a?.name))
    .filter((a) =>
      a.name!.split("/").map((s) => s.trim().split(/\s+/)[0].toUpperCase()).includes(up)
    );
}

/**
 * Global 24h volume by symbol, from two pages of CoinGecko's market list.
 *
 * Two calls total instead of two per token: the per-symbol search endpoint made this script take
 * ten minutes and repeatedly tripped the free rate limit.
 */
async function globalVolumes(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const page of [1, 2, 3]) {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) break;
    for (const c of (await res.json()) as Array<{ symbol: string; total_volume: number }>) {
      const k = c.symbol.toUpperCase();
      if (!map.has(k)) map.set(k, c.total_volume);
    }
    await sleep(3000 * PACE);
  }
  return map;
}

console.log("Fetching global volumes...");
const global = await globalVolumes();
console.log(`  ${global.size} symbols known\n`);

const rows: Record<string, unknown>[] = [];
const good: Array<{ symbol: string; address: string; name: string }> = [];

for (const [i, symbol] of CANDIDATES.entries()) {
  if (i > 0) await sleep(2200 * PACE);

  try {
    const pools = await basePools(symbol);
    if (pools.length === 0) {
      rows.push({ symbol, pools: 0, verdict: "NO BASE POOL" });
      console.log(`  ${symbol}: no pool`);
      continue;
    }

    const baseVol = pools.reduce((a, p) => a + Number(p.volume_usd?.h24 ?? 0), 0);
    const top = [...pools].sort(
      (a, b) => Number(b.reserve_in_usd ?? 0) - Number(a.reserve_in_usd ?? 0)
    )[0];
    const liq = Number(top.reserve_in_usd ?? 0);

    await sleep(2200 * PACE);
    let bars = 0;
    try {
      bars = (await fetchPoolHistory(top.address!, 1000)).length;
    } catch { /* leave 0 */ }

    const g = global.get(symbol.toUpperCase()) ?? null;
    const share = g && g > 0 ? baseVol / g : null;

    let verdict: string;
    if (bars < MIN_BARS) verdict = `THIN HISTORY (${bars})`;
    else if (liq < MIN_LIQUIDITY) verdict = "LOW LIQUIDITY";
    else if (share === null) verdict = "SHARE UNKNOWN";
    else if (share < MIN_BASE_SHARE) verdict = `MISMATCH (${(share * 100).toFixed(1)}%)`;
    else verdict = "GOOD";

    if (verdict === "GOOD") good.push({ symbol, address: top.address!, name: top.name! });

    rows.push({
      symbol,
      pools: pools.length,
      topPool: (top.name ?? "").slice(0, 20),
      liquidity: "$" + Math.round(liq).toLocaleString(),
      baseVol24h: "$" + Math.round(baseVol).toLocaleString(),
      globalVol24h: g === null ? "-" : "$" + Math.round(g).toLocaleString(),
      onBase: share === null ? "-" : (share * 100).toFixed(1) + "%",
      bars,
      verdict,
    });
    console.log(`  ${symbol}: ${verdict}`);
  } catch (err) {
    rows.push({ symbol, verdict: `ERROR ${(err as Error).message.slice(0, 24)}` });
    console.log(`  ${symbol}: error`);
  }
}

console.log("\n" + "=".repeat(120));
console.table(rows);
console.log(`\n${good.length} of ${CANDIDATES.length} usable.\n`);
console.log("Paste-ready watchlist entries (VERIFY each address on BaseScan first):\n");
for (const g of good) {
  console.log(`  // ${g.name}`);
  console.log(`  { symbol: "${g.symbol}", dexscreenerPairAddress: "${g.address}" },`);
}
