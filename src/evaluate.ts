/**
 * Scores the most recent bucket already in history and narrates it if it crosses the threshold.
 *
 *   npm run evaluate
 *
 * Separate from the runner because the two answer different questions. The runner RECORDS new
 * data (and skips buckets it already has); this only READS what is there and decides whether it
 * deserves narration. That split is what lets the scheduled CI pass work: it rebuilds history
 * from provider APIs via backfill, then evaluates - with no dependency on state carried between
 * runs, and no risk of backfill silently suppressing narration by claiming the bucket first.
 *
 * Idempotent: an event already in the feed is not narrated twice, so re-running is free.
 */
import { watchlist } from "./config.js";
import { computeDivergence } from "./engine/divergence.js";
import { readHistory } from "./engine/history.js";
import { appendToFeed, hasEvent, readFeed } from "./engine/feed.js";
import { narrateDivergence } from "./narration/narrate.js";
import { fetchRpcCrossCheck } from "./sources/baseRpc.js";
import { fetchOnchainSnapshot } from "./sources/dexscreener.js";

let newEvents = 0;

for (const watched of watchlist) {
  const symbol = watched.symbol;

  try {
    const history = await readHistory(symbol);
    if (history.length === 0) {
      console.log(`[${symbol}] no history - run backfill first`);
      continue;
    }

    const latest = history[history.length - 1];
    const divergence = computeDivergence(symbol, history);
    const bucket = new Date(latest.timestampMs).toISOString();

    if (!divergence.significant) {
      console.log(
        `[${symbol}] ${bucket} divergence=${divergence.divergenceScore?.toFixed(2) ?? "n/a"} - below threshold`
      );
      continue;
    }

    const feed = await readFeed();
    if (hasEvent(feed, symbol, latest.timestampMs)) {
      console.log(`[${symbol}] ${bucket} already narrated - skipping`);
      continue;
    }

    // Only fetched for events, since it exists to enrich narration rather than to score.
    const onchain = await fetchOnchainSnapshot(watched.dexscreenerPairAddress).catch(() => null);

    const rpcCrossCheck = watched.rpcPoolAddress
      ? await fetchRpcCrossCheck(watched.rpcPoolAddress, onchain?.liquidityUsd ?? null).catch(
          () => null
        )
      : null;

    const enriched = onchain ? { ...latest, onchain: { ...onchain, ...latest.onchain } } : latest;
    const narration = await narrateDivergence(enriched, divergence, rpcCrossCheck);

    const added = await appendToFeed({
      token: symbol,
      timestampMs: latest.timestampMs,
      divergence,
      rpcCrossCheck,
      narration,
    });

    if (added) newEvents++;
    console.log(
      `[${symbol}] ${bucket} EVENT divergence=${divergence.divergenceScore?.toFixed(2)}\n` +
        `  ${narration.replace(/\n/g, "\n  ")}`
    );
  } catch (err) {
    console.error(`[${symbol}] evaluate failed:`, err instanceof Error ? err.message : err);
  }
}

console.log(`\n${newEvents} new event(s) written to the feed.`);
