/**
 * Focused OHLCV depth check on a handful of pools, spaced out enough to stay under
 * GeckoTerminal's free rate limit. Reports usable history rather than raw bar count:
 * a pool only contributes hours that overlap the ~740 hours of social data available.
 */
import { fetchPoolHistory } from "../src/sources/geckoterminal.js";

const POOLS: Array<[string, string]> = [
  ["AERO   (AERO/USDC)", "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d"],
  ["VIRTUAL(VIRTUAL/WETH)", "0x21594b992f68495dd28d605834b58889d0a727c7"],
  ["KEYCAT (KEYCAT/WETH)", "0x377feeed4820b3b28d1ab429509e7a0789824fca"],
  ["BNKR   (BNKR/WETH)", "0xaec085e5a5ce8d96a7bdd3eb3a62445d4f6ce703"],
  ["MORPHO (MORPHO/WETH)", "0xb5f0b4ae66c14f7efaa9aa1468e8fc536a3e288c"],
];

/** Hours of social history available to join against, from the screening run. */
const SOCIAL_HOURS = 740;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const [i, [label, address]] of POOLS.entries()) {
  if (i > 0) await sleep(8000);

  try {
    const bars = await fetchPoolHistory(address, 1000);
    if (bars.length === 0) {
      console.log(`${label}: 0 bars`);
      continue;
    }

    const spanHours = (bars[bars.length - 1].timestampMs - bars[0].timestampMs) / 3_600_000;
    const zeroVol = bars.filter((b) => b.volumeUsd === 0).length;
    const usable = Math.min(bars.length, SOCIAL_HOURS);

    console.log(
      `${label}: ${bars.length} bars over ${spanHours.toFixed(0)}h, ` +
        `${zeroVol} zero-volume (${((zeroVol / bars.length) * 100).toFixed(1)}%), ` +
        `~${usable} usable after social join`
    );
  } catch (err) {
    console.log(`${label}: FAILED - ${(err as Error).message}`);
  }
}
