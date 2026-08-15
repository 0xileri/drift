/**
 * Calibrates DIVERGENCE_THRESHOLD against real data by replaying history through the actual
 * engine (not a copy of its math, so it can't drift out of sync with what ships).
 *
 * Usage:
 *   npm run calibrate                 # onchain axis only, using public GeckoTerminal pools
 *   npm run calibrate -- --watchlist  # both axes, using backfilled history in data/history
 *
 * The default mode holds the social axis constant, so it characterises the ONCHAIN half of the
 * divergence distribution only. Re-run with --watchlist after `npm run backfill` to calibrate
 * against real social data — the threshold that comes out of the default mode is a starting
 * point, not a final answer.
 */
import { computeDivergence } from "../src/engine/divergence.js";
import { readHistory } from "../src/engine/history.js";
import { fetchPoolHistory } from "../src/sources/geckoterminal.js";
import { watchlist } from "../src/config.js";
import type { PollSnapshot } from "../src/types.js";

/** Public Base pools used when no backfilled history exists yet. */
const SAMPLE_POOLS: Record<string, string> = {
  "WETH/USDC": "0x6c561b446416e1a00e8e93e221854d6ea4171372",
  "VELVET/USDC": "0x6b0f53cbd9272d8117e9535fe25371dedf39a1be",
  "BNKR/WETH": "0xaec085e5a5ce8d96a7bdd3eb3a62445d4f6ce703",
  "QUID/USDC": "0x07c4bc0f5fb6cb069124df3e1ae0b8fd8148ccc4",
};

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
}

/** Replays a series one step at a time, exactly as live polling would see it. */
/** Accumulated across tokens so the recommendation can pool them. */
const allScores: number[] = [];
const scoredTokens: string[] = [];

function scoreSeries(label: string, series: PollSnapshot[]): void {
  const scores: number[] = [];
  for (let i = 2; i <= series.length; i++) {
    const result = computeDivergence(label, series.slice(0, i));
    if (result.divergenceScore !== null) scores.push(Math.abs(result.divergenceScore));
  }

  if (scores.length === 0) {
    console.log(`\n${label}: no scorable points (not enough history)`);
    return;
  }

  allScores.push(...scores);
  scoredTokens.push(label);

  const sorted = [...scores].sort((a, b) => a - b);
  const rate = (t: number) => ((sorted.filter((s) => s >= t).length / sorted.length) * 100).toFixed(1);

  console.log(`\n${label}  (${scores.length} scored points)`);
  console.log(
    `  |divergence| median ${quantile(sorted, 0.5).toFixed(2)}  ` +
      `p90 ${quantile(sorted, 0.9).toFixed(2)}  p99 ${quantile(sorted, 0.99).toFixed(2)}  ` +
      `max ${sorted[sorted.length - 1].toFixed(2)}`
  );
  console.log(
    `  fire rate  >=2.0: ${rate(2.0)}%   >=3.0: ${rate(3.0)}%   ` +
      `>=3.5: ${rate(3.5)}%   >=4.0: ${rate(4.0)}%   >=5.0: ${rate(5.0)}%`
  );
}

async function calibrateFromPools(): Promise<void> {
  console.log(
    "Mode: ONCHAIN AXIS ONLY (social held constant). Treat results as a lower bound —\n" +
      "real social movement widens the distribution. Re-run with --watchlist after backfill.\n"
  );

  for (const [name, pool] of Object.entries(SAMPLE_POOLS)) {
    const bars = await fetchPoolHistory(pool, 1000);
    const series: PollSnapshot[] = bars.map((bar) => ({
      token: name,
      timestampMs: bar.timestampMs,
      social: { galaxyScore: 50, altRank: null, sentiment: null, socialVolume: 1000 },
      onchain: {
        priceUsd: bar.close,
        intervalVolumeUsd: bar.volumeUsd,
        volume24hUsd: null,
        liquidityUsd: null,
        txns24h: null,
      },
    }));
    scoreSeries(name, series);
  }
}

async function calibrateFromWatchlist(): Promise<void> {
  console.log("Mode: BOTH AXES, from backfilled history in data/history.\n");

  for (const watched of watchlist) {
    const history = await readHistory(watched.symbol);
    if (history.length === 0) {
      console.log(`\n${watched.symbol}: no history — run \`npm run backfill\` first.`);
      continue;
    }
    scoreSeries(watched.symbol, history);
  }
}

/**
 * Recommends a threshold from the pooled distribution rather than per token, so one noisy token
 * can't drag the setting for the rest. Target is expressed as events per token per day, which is
 * the unit that actually matters when deciding whether a feed is readable.
 */
function recommend(targetPerTokenPerDay: number): void {
  if (allScores.length === 0) return;

  const sorted = [...allScores].sort((a, b) => a - b);
  const targetRate = targetPerTokenPerDay / 24; // hourly buckets
  const idx = Math.floor(sorted.length * (1 - targetRate));
  const threshold = sorted[Math.min(idx, sorted.length - 1)];

  const actual = sorted.filter((s) => s >= threshold).length / sorted.length;
  const tokens = new Set(scoredTokens).size;

  console.log("\n" + "=".repeat(72));
  console.log(`Pooled across ${tokens} tokens, ${sorted.length} scored hours.`);
  console.log(
    `For ~${targetPerTokenPerDay} event(s) per token per day, ` +
      `DIVERGENCE_THRESHOLD = ${threshold.toFixed(1)}`
  );
  console.log(
    `  -> fires on ${(actual * 100).toFixed(1)}% of hours ` +
      `(~${(actual * 24).toFixed(1)}/token/day, ~${(actual * 24 * tokens).toFixed(1)}/day total)`
  );
  for (const t of [4, 5, 6, 7, 8, 9]) {
    const r = sorted.filter((s) => s >= t).length / sorted.length;
    console.log(
      `  at ${t}.0: ${(r * 100).toFixed(1)}% of hours, ~${(r * 24 * tokens).toFixed(1)} events/day total`
    );
  }
}

const useWatchlist = process.argv.includes("--watchlist");
await (useWatchlist ? calibrateFromWatchlist() : calibrateFromPools());
recommend(Number(process.argv.find((a) => a.startsWith("--per-day="))?.split("=")[1] ?? 1));
