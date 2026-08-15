/**
 * Replays recorded history through the engine and narrates the divergences it finds, so the feed
 * carries real past events instead of sitting empty until enough live hours accumulate.
 *
 *   npm run backfill:feed              # dry run - counts events, spends nothing
 *   npm run backfill:feed -- --commit  # narrates and writes them
 *   npm run backfill:feed -- --commit --limit=40
 *
 * Backfilled events are flagged as such. They are real engine output over real recorded data,
 * but they were not produced by a live poll at the time they describe, and presenting them as
 * live would misrepresent when the agent actually saw them.
 *
 * The RPC cross-check is deliberately null on these: getReserves() reads the pool's CURRENT
 * state, so running it now would attach today's reserves to a week-old event and imply a
 * verification that never happened.
 */
import { watchlist, DIVERGENCE_THRESHOLD } from "../src/config.js";
import { computeDivergence } from "../src/engine/divergence.js";
import { readHistory } from "../src/engine/history.js";
import { appendToFeed, readFeed, hasEvent } from "../src/engine/feed.js";
import { narrateDivergence } from "../src/narration/narrate.js";
import type { DivergenceResult, PollSnapshot } from "../src/types.js";

const COMMIT = process.argv.includes("--commit");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);

/** Anthropic rate limits are generous, but a burst of 100 calls is still worth spacing out. */
const NARRATION_SPACING_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Candidate {
  token: string;
  snapshot: PollSnapshot;
  divergence: DivergenceResult;
}

const candidates: Candidate[] = [];

for (const watched of watchlist) {
  const history = await readHistory(watched.symbol);
  if (history.length === 0) {
    console.log(`[${watched.symbol}] no history`);
    continue;
  }

  let found = 0;
  // Replay forward: at each hour the engine sees only what it would have seen live.
  for (let i = 2; i <= history.length; i++) {
    const slice = history.slice(0, i);
    const divergence = computeDivergence(watched.symbol, slice);
    if (!divergence.significant) continue;
    candidates.push({ token: watched.symbol, snapshot: slice[slice.length - 1], divergence });
    found++;
  }

  console.log(`[${watched.symbol}] ${history.length} hours -> ${found} events`);
}

candidates.sort((a, b) => a.snapshot.timestampMs - b.snapshot.timestampMs);

const existing = await readFeed();
const fresh = candidates.filter((c) => !hasEvent(existing, c.token, c.snapshot.timestampMs));

const peak = candidates.reduce(
  (a, b) =>
    Math.abs(b.divergence.divergenceScore ?? 0) > Math.abs(a.divergence.divergenceScore ?? 0)
      ? b
      : a,
  candidates[0]
);

console.log("\n" + "=".repeat(70));
console.log(`threshold        ${DIVERGENCE_THRESHOLD}`);
console.log(`events found     ${candidates.length}`);
console.log(`already in feed  ${candidates.length - fresh.length}`);
console.log(`to narrate       ${Math.min(fresh.length, LIMIT)}`);
if (peak) {
  console.log(
    `strongest        ${peak.token} ${peak.divergence.divergenceScore?.toFixed(2)} ` +
      `at ${new Date(peak.snapshot.timestampMs).toISOString()}`
  );
}

if (!COMMIT) {
  console.log(`\nDry run - nothing written, no API calls made.`);
  console.log(`Re-run with --commit to narrate and write these to the feed.`);
  process.exit(0);
}

const work = fresh.slice(0, LIMIT);
let written = 0;

for (const [i, c] of work.entries()) {
  try {
    const narration = await narrateDivergence(c.snapshot, c.divergence, null);
    const added = await appendToFeed({
      token: c.token,
      timestampMs: c.snapshot.timestampMs,
      divergence: c.divergence,
      rpcCrossCheck: null,
      narration,
      backfilled: true,
    });
    if (added) written++;
    console.log(
      `  ${i + 1}/${work.length}  ${c.token} ` +
        `${new Date(c.snapshot.timestampMs).toISOString()} ` +
        `d=${c.divergence.divergenceScore?.toFixed(2)}`
    );
  } catch (err) {
    console.error(`  ${i + 1}/${work.length}  ${c.token} FAILED:`, (err as Error).message);
  }
  if (i < work.length - 1) await sleep(NARRATION_SPACING_MS);
}

console.log(`\n${written} event(s) written to the feed.`);
