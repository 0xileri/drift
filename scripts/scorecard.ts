/**
 * Publishes what followed every divergence event.
 *
 *   npm run scorecard              # current threshold
 *   npm run scorecard -- --sweep   # hit rate across candidate thresholds
 *
 * Writes data/scorecard.json for the site. The point is not a good number - it is a checkable
 * one. An agent that reports its own miss rate can be evaluated; one that reports 92 confident
 * readings and never revisits them cannot.
 */
import { writeFile } from "node:fs/promises";
import { watchlist, DIVERGENCE_THRESHOLD } from "../src/config.js";
import { readHistory } from "../src/engine/history.js";
import { computeDivergence } from "../src/engine/divergence.js";
import { outcomesForEvent, HORIZONS, type Resolution } from "../src/engine/outcomes.js";
import type { PollSnapshot } from "../src/types.js";

const sweep = process.argv.includes("--sweep");

const histories = new Map<string, PollSnapshot[]>();
for (const w of watchlist) {
  const h = await readHistory(w.symbol);
  if (h.length) histories.set(w.symbol, h);
}

/** Every hour whose score clears `threshold` and is not volume-suppressed. */
function eventsAt(threshold: number) {
  const out: Array<{ token: string; timestampMs: number; score: number; direction: string }> = [];
  for (const [token, h] of histories) {
    for (let i = 26; i <= h.length; i++) {
      const d = computeDivergence(token, h.slice(0, i));
      if (d.divergenceScore === null || d.suppressedReason) continue;
      if (Math.abs(d.divergenceScore) < threshold) continue;
      out.push({
        token,
        timestampMs: h[i - 1].timestampMs,
        score: d.divergenceScore,
        direction: d.direction ?? "",
      });
    }
  }
  return out;
}

/**
 * How often the "followed" condition holds on ANY hour, event or not.
 *
 * Without this, a 31% follow-through rate is unreadable: it is only evidence the score selects
 * useful hours if it beats what you would get by picking hours at random.
 */
function baseRate(horizon: number): number {
  let hit = 0, total = 0;
  for (const [, h] of histories) {
    for (let i = 6; i < h.length - horizon; i++) {
      const before = h.slice(i - 6, i).map((s) => s.onchain.intervalVolumeUsd).filter((v): v is number => v != null);
      const after = h.slice(i + 1, i + 1 + horizon).map((s) => s.onchain.intervalVolumeUsd).filter((v): v is number => v != null);
      if (before.length < 3 || after.length < 3) continue;
      const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
      const b = mean(before);
      if (b <= 0) continue;
      total++;
      if (mean(after) >= b * 1.25) hit++;
    }
  }
  return total ? hit / total : 0;
}

function tally(threshold: number) {
  const events = eventsAt(threshold);
  const counts: Record<number, Record<Resolution, number>> = {};
  for (const h of HORIZONS) {
    counts[h] = { followed: 0, "no-follow": 0, unknown: 0 };
  }

  for (const e of events) {
    for (const o of outcomesForEvent(e.token, histories.get(e.token)!, e.timestampMs)) {
      counts[o.horizon][o.resolution]++;
    }
  }
  return { events, counts };
}

if (sweep) {
  console.log("threshold  events   converged   faded    open   widened   (at t+6)\n");
  for (const t of [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]) {
    const { events, counts } = tally(t);
    const c = counts[6];
    const judged = c.followed + c["no-follow"];
    const pct = (n: number) => (judged ? `${((100 * n) / judged).toFixed(0)}%` : "-");
    console.log(
      `  ${t.toFixed(1)}      ${String(events.length).padStart(4)}      ` +
        `${pct(c.followed).padStart(6)}      ${pct(c["no-follow"]).padStart(6)}`
    );
  }
  console.log(
    "\nconverged = the lagging series moved toward the leader (the claim the agent implies)\n" +
      "faded     = the leading series fell back instead; the gap closed but nothing followed\n" +
      "A threshold is only better if it raises converged WITHOUT simply shrinking the sample."
  );
  process.exit(0);
}

const { events, counts } = tally(DIVERGENCE_THRESHOLD);

console.log(`Threshold ${DIVERGENCE_THRESHOLD} · ${events.length} events\n`);
const summary: Record<string, unknown> = {};

for (const h of HORIZONS) {
  const c = counts[h];
  const judged = c.followed + c["no-follow"];
  const pct = (n: number) => (judged ? (100 * n) / judged : 0);
  console.log(
    `t+${String(h).padStart(2)}h  judged ${String(judged).padStart(3)}  ` +
      `followed ${pct(c.followed).toFixed(0).padStart(3)}%  ` +
      `no-follow ${pct(c["no-follow"]).toFixed(0).padStart(3)}%` +
      (c.unknown ? `  (${c.unknown} too recent to judge)` : "")
  );
  summary[`t+${h}h`] = {
    judged,
    followedPct: Number(pct(c.followed).toFixed(1)),
    noFollowPct: Number(pct(c["no-follow"]).toFixed(1)),
    unknown: c.unknown,
  };
}

const base6 = baseRate(6);

const dirs: Record<string, number> = {};
for (const e of events) dirs[e.direction] = (dirs[e.direction] ?? 0) + 1;
console.log(`\ndirection mix: ${JSON.stringify(dirs)}`);

const eventRate6 = (summary["t+6h"] as { followedPct: number }).followedPct;
console.log(
  `
BASE RATE: ${(100 * base6).toFixed(1)}% of ALL hours meet the same test at t+6.
` +
    `EVENTS:    ${eventRate6.toFixed(1)}% of flagged hours do.
` +
    `LIFT:      ${(eventRate6 - 100 * base6).toFixed(1)} points.

` +
    `A lift at or below zero means the score is not selecting hours where the lagging series is
` +
    `more likely to move. That is a real result about this method on this data, and publishing
` +
    `it is the point - an agent whose claims cannot fail is not making claims.`
);

await writeFile(
  "data/scorecard.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      threshold: DIVERGENCE_THRESHOLD,
      events: events.length,
      tokens: [...histories.keys()],
      directionMix: dirs,
      horizons: summary,
      baseRateT6Pct: Number((100 * base6).toFixed(1)),
      liftT6Points: Number((eventRate6 - 100 * base6).toFixed(1)),
      note:
        "followed = the lagging series averaged at least 25% above its own pre-event baseline " +
        "in the hours after the event. Measured on LEVELS, not z-scores: a z-score is " +
        "mean-reverting by construction, so comparing scores before and after would report a " +
        "fade for almost any event regardless of what the underlying series did. Replayed from " +
        "recorded history, not a live forward test.",
    },
    null,
    2
  ) + "\n",
  "utf8"
);
console.log("\nwrote data/scorecard.json");
