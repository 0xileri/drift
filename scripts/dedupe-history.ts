/**
 * Removes duplicate-hour rows from the history files, keeping the earliest row per bucket.
 *
 * Needed once because an earlier runner stamped snapshots with wall-clock time instead of the
 * bucket they described, so repeat polls inside one hour wrote rows that duplicated data already
 * present. Those rows carry log(x/x) = 0 momentum, and enough of them collapse the MAD the
 * robust z-score divides by.
 *
 *   npm run dedupe
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HISTORY_DIR } from "../src/config.js";
import type { PollSnapshot } from "../src/types.js";

const HOUR_MS = 3_600_000;
const dir = fileURLToPath(HISTORY_DIR);

for (const file of (await readdir(dir)).filter((f) => f.endsWith(".jsonl"))) {
  const path = `${dir}${file}`;
  const rows = (await readFile(path, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as PollSnapshot);

  const byHour = new Map<number, PollSnapshot>();
  let unaligned = 0;

  for (const row of rows) {
    const hour = Math.floor(row.timestampMs / HOUR_MS) * HOUR_MS;
    if (row.timestampMs !== hour) unaligned++;
    // Keep the first row seen for an hour; later ones are re-reads of the same closed bucket.
    if (!byHour.has(hour)) byHour.set(hour, { ...row, timestampMs: hour });
  }

  const byTimestamp = [...byHour.values()].sort((a, b) => a.timestampMs - b.timestampMs);

  /**
   * Drop rows whose payload repeats the previous row's.
   *
   * A misstamped row is not caught by timestamp dedupe: a poll that read the 23:00 bucket but
   * recorded it as 00:56 becomes a distinct 00:00 row carrying 23:00's numbers. Identical volume
   * AND identical interactions in consecutive hours is a re-read, not a coincidence - volume is a
   * float that effectively never repeats exactly.
   */
  const kept: PollSnapshot[] = [];
  let repeats = 0;

  for (const row of byTimestamp) {
    const prev = kept[kept.length - 1];
    const samePayload =
      prev !== undefined &&
      prev.onchain.intervalVolumeUsd === row.onchain.intervalVolumeUsd &&
      prev.social.socialVolume === row.social.socialVolume;

    if (samePayload) {
      repeats++;
      continue;
    }
    kept.push(row);
  }

  const removed = rows.length - kept.length;

  if (removed === 0 && unaligned === 0) {
    console.log(`${file}: clean (${rows.length} rows)`);
    continue;
  }

  await writeFile(path, kept.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  console.log(
    `${file}: ${rows.length} -> ${kept.length} rows ` +
      `(${removed - repeats} duplicate-hour, ${repeats} repeated-payload, ${unaligned} unaligned)`
  );
}
