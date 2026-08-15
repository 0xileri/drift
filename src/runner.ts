import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { watchlist } from "./config.js";
import { fetchOnchainSnapshot } from "./sources/dexscreener.js";
import { fetchSocialSnapshot } from "./sources/lunarcrush.js";
import { fetchRpcCrossCheck } from "./sources/baseRpc.js";
import { fetchLatestBar } from "./sources/geckoterminal.js";
import { appendSnapshot, readHistory } from "./engine/history.js";
import { computeDivergence } from "./engine/divergence.js";
import { appendToFeed } from "./engine/feed.js";
import { narrateDivergence } from "./narration/narrate.js";
import type { PollSnapshot } from "./types.js";

async function pollToken(watched: (typeof watchlist)[number]): Promise<void> {
  const symbol = watched.symbol;

  const [social, onchain, latestBar] = await Promise.all([
    fetchSocialSnapshot(watched.lunarcrushSymbol ?? symbol),
    fetchOnchainSnapshot(watched.dexscreenerPairAddress),
    fetchLatestBar(watched.dexscreenerPairAddress),
  ]);

  if (!latestBar) {
    console.log(`[${symbol}] no closed hourly bar available yet - skipping`);
    return;
  }

  const existing = await readHistory(symbol);
  const alreadyRecorded = existing.some((s) => s.timestampMs === latestBar.timestampMs);

  if (alreadyRecorded) {
    // Both sources report the latest CLOSED hour, so polling more than once inside the same hour
    // sees identical data. Appending it would write a duplicate whose momentum is log(x/x) = 0,
    // and a baseline padded with zeros collapses MAD toward zero - which makes the robust
    // z-score saturate at its cap on the next real move. Skipping keeps one row per hour.
    console.log(
      `[${symbol}] bucket ${new Date(latestBar.timestampMs).toISOString()} already recorded - skipping`
    );
    return;
  }

  const snapshot: PollSnapshot = {
    token: symbol,
    // Keyed to the bucket the data describes, not to wall-clock time, so live rows line up with
    // backfilled ones and stay idempotent across repeat polls.
    timestampMs: latestBar.timestampMs,
    social,
    // intervalVolumeUsd comes from GeckoTerminal so live snapshots use the same hourly-bucket
    // metric as backfilled ones; DexScreener supplies liquidity/txn context around it.
    onchain: { ...onchain, intervalVolumeUsd: latestBar.volumeUsd },
  };

  await appendSnapshot(snapshot);
  const history = [...existing, snapshot];
  const divergence = computeDivergence(symbol, history);

  console.log(
    `[${symbol}] socialLR=${divergence.socialMomentumLogRatio?.toFixed(3) ?? "n/a"} ` +
      `onchainLR=${divergence.onchainMomentumLogRatio?.toFixed(3) ?? "n/a"} ` +
      `divergence=${divergence.divergenceScore?.toFixed(2) ?? "n/a (warming up)"}`
  );

  if (!divergence.significant) return;

  const rpcCrossCheck = watched.rpcPoolAddress
    ? await fetchRpcCrossCheck(watched.rpcPoolAddress, onchain.liquidityUsd)
    : null;

  const narration = await narrateDivergence(snapshot, divergence, rpcCrossCheck);

  console.log(`[${symbol}] DIVERGENCE EVENT: ${narration}`);

  await appendToFeed({
    token: symbol,
    timestampMs: snapshot.timestampMs,
    divergence,
    rpcCrossCheck,
    narration,
  });
}

/**
 * Runs one poll cycle across the whole watchlist.
 *
 * Exported so the scheduler drives the same code path as a manual `npm run poll` - a scheduler
 * with its own copy of this loop would drift from what gets tested by hand.
 *
 * Never throws: one token's failure must not abort the others or kill a long-running scheduler.
 * Returns a per-token outcome so callers can report on it.
 */
export async function runPollCycle(): Promise<{ ok: number; failed: number }> {
  if (watchlist.length === 0) {
    throw new Error("Watchlist is empty. Add verified tokens to src/config.ts.");
  }

  const results = await Promise.allSettled(watchlist.map(pollToken));

  let failed = 0;
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failed++;
      console.error(`[${watchlist[i].symbol}] poll failed:`, result.reason);
    }
  });

  return { ok: results.length - failed, failed };
}

/** Only self-run when invoked directly, so importing this module doesn't trigger a poll. */
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  runPollCycle().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

