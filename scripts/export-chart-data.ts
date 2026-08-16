/**
 * Exports a real slice of history as chart-ready JSON for the website.
 *
 * The site plots actual recorded data, not a drawn-in illustration - the whole pitch is that
 * every figure traces to a real call, and a decorative fake curve would quietly contradict it.
 */
import { writeFile } from "node:fs/promises";
import { readHistory } from "../src/engine/history.js";
import { computeDivergence } from "../src/engine/divergence.js";
import type { PollSnapshot } from "../src/types.js";

const TOKEN = process.argv[2] ?? "AERO";
const WINDOW = Number(process.argv[3] ?? 168); // one week of hourly buckets

const history = await readHistory(TOKEN);
if (history.length === 0) {
  console.error(`No history for ${TOKEN}. Run backfill first.`);
  process.exit(1);
}

// Replay incrementally so each point carries the z-scores the engine actually saw at that hour.
const points: Array<{ t: number; socialRank: number; onchainRank: number; divergence: number }> = [];
const start = Math.max(2, history.length - WINDOW);

for (let i = start; i <= history.length; i++) {
  const slice: PollSnapshot[] = history.slice(0, i);
  const d = computeDivergence(TOKEN, slice);
  if (d.socialRank === null || d.onchainRank === null || d.divergenceScore === null) continue;
  points.push({
    t: slice[slice.length - 1].timestampMs,
    socialRank: Number(d.socialRank.toFixed(3)),
    onchainRank: Number(d.onchainRank.toFixed(3)),
    divergence: Number(d.divergenceScore.toFixed(3)),
  });
}

const peak = points.reduce((a, b) => (Math.abs(b.divergence) > Math.abs(a.divergence) ? b : a));

const out = {
  token: TOKEN,
  generatedAt: new Date().toISOString(),
  from: new Date(points[0].t).toISOString(),
  to: new Date(points[points.length - 1].t).toISOString(),
  count: points.length,
  peak: { at: new Date(peak.t).toISOString(), divergence: peak.divergence },
  points,
};

await writeFile("site/chart-data.json", JSON.stringify(out, null, 2), "utf8");
console.log(
  `${TOKEN}: ${points.length} points, ${out.from} -> ${out.to}\n` +
    `peak |divergence| ${peak.divergence} at ${out.peak.at}`
);
