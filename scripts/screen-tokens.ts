/**
 * Screens candidate tokens for whether they can actually produce a divergence signal.
 *
 * A token is only usable if BOTH axes carry information:
 *   - social:  interactions are present AND actually move (a flat series has no momentum)
 *   - onchain: a Base pool with enough hourly bars and real volume
 *
 * Backfill joins the two on the hour and drops any hour missing either side, so a token with
 * sparse social coverage yields almost no history no matter how liquid its pool is.
 *
 * Throttled to respect the Individual tier's 10 req/min limit.
 *
 *   npm run screen
 */
import "dotenv/config";
import { fetchSocialHistory } from "../src/sources/lunarcrush.js";

/** Symbols with a plausible Base presence. Edit freely. */
const CANDIDATES = [
  "AERO",
  "BRETT",
  "DEGEN",
  "TOSHI",
  "VIRTUAL",
  "MORPHO",
  "HIGHER",
  "KEYCAT",
  "AVNT",
  "BNKR",
];

/** Individual tier is 10 req/min; 7s spacing leaves headroom. */
const THROTTLE_MS = 7000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mean(v: number[]) {
  return v.reduce((s, x) => s + x, 0) / v.length;
}

/** Coefficient of variation — does this series actually move, or is it flat? */
function coefficientOfVariation(v: number[]): number {
  const m = mean(v);
  if (m === 0) return 0;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  return sd / m;
}

interface Row {
  symbol: string;
  points: number;
  withInteractions: number;
  coverage: string;
  cv: string;
  medianInteractions: number;
  verdict: string;
}

const rows: Row[] = [];

for (const [i, symbol] of CANDIDATES.entries()) {
  if (i > 0) await sleep(THROTTLE_MS);

  try {
    const series = await fetchSocialHistory(symbol, "1m", "hour");
    const interactions = series
      .map((p) => p.social.socialVolume)
      .filter((v): v is number => v !== null && Number.isFinite(v));

    const coverage = series.length ? interactions.length / series.length : 0;
    const cv = interactions.length > 1 ? coefficientOfVariation(interactions) : 0;
    const sorted = [...interactions].sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

    let verdict: string;
    if (series.length === 0) verdict = "NO DATA";
    else if (coverage < 0.8) verdict = "SPARSE - skip";
    else if (cv < 0.15) verdict = "TOO FLAT - no momentum";
    else if (med < 100) verdict = "LOW VOLUME - noisy";
    else verdict = "GOOD";

    rows.push({
      symbol,
      points: series.length,
      withInteractions: interactions.length,
      coverage: `${(coverage * 100).toFixed(0)}%`,
      cv: cv.toFixed(2),
      medianInteractions: Math.round(med),
      verdict,
    });
    console.log(`  checked ${symbol} (${series.length} pts)`);
  } catch (err) {
    rows.push({
      symbol,
      points: 0,
      withInteractions: 0,
      coverage: "-",
      cv: "-",
      medianInteractions: 0,
      verdict: `ERROR: ${(err as Error).message.slice(0, 40)}`,
    });
    console.log(`  checked ${symbol} - failed`);
  }
}

console.log("\n" + "=".repeat(88));
console.table(rows);
console.log(
  "\nGOOD = enough hourly coverage, interactions actually vary, and volume high enough to trust.\n" +
    "Pair each GOOD symbol with a Base pool (GeckoTerminal), then add both to src/config.ts."
);
