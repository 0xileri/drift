/**
 * Long-running poller. Wakes shortly after each hour boundary, runs one poll cycle, sleeps again.
 *
 *   npm run schedule
 *
 * Why just after the hour, not on it: both providers publish data per closed hourly bucket, and
 * the bucket that just ended takes a little while to appear. Polling at :00 exactly tends to read
 * the previous hour and then skip as already-recorded, wasting the cycle. The offset is
 * configurable via POLL_OFFSET_MINUTES.
 *
 * The runner is idempotent per bucket, so a missed or duplicated wake-up is harmless - it will
 * either catch up on the next hour or skip. That means this process is safe to restart at will.
 */
import { runPollCycle } from "./runner.js";

const OFFSET_MIN = Number(process.env.POLL_OFFSET_MINUTES ?? 5);
const HOUR_MS = 3_600_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function msUntilNextRun(): number {
  const now = Date.now();
  const thisHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const target = thisHour + OFFSET_MIN * 60_000;
  return target > now ? target - now : target + HOUR_MS - now;
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

let stop = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[${stamp()}] ${signal} received - stopping after current cycle.`);
    stop = true;
    // A cycle can take a while; don't leave the user stuck if they hit Ctrl-C twice.
    process.on(signal, () => process.exit(130));
  });
}

console.log(
  `[${stamp()}] scheduler started - polling at :${String(OFFSET_MIN).padStart(2, "0")} past each hour.\n` +
    `Ctrl-C to stop.`
);

// Poll once at startup so the operator sees it working rather than waiting up to an hour.
let cycle = 0;

while (!stop) {
  cycle++;
  const started = Date.now();

  try {
    const { ok, failed } = await runPollCycle();
    console.log(
      `[${stamp()}] cycle ${cycle} done in ${((Date.now() - started) / 1000).toFixed(0)}s ` +
        `- ${ok} ok, ${failed} failed`
    );
  } catch (err) {
    // Keep the loop alive: a scheduler that dies on one bad cycle defeats the point.
    console.error(`[${stamp()}] cycle ${cycle} errored:`, err instanceof Error ? err.message : err);
  }

  if (stop) break;

  const wait = msUntilNextRun();
  const nextAt = new Date(Date.now() + wait).toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${stamp()}] sleeping ${(wait / 60000).toFixed(0)}m - next cycle at ${nextAt}Z\n`);

  // Sleep in short slices so Ctrl-C is honoured promptly instead of after an hour.
  const deadline = Date.now() + wait;
  while (!stop && Date.now() < deadline) {
    await sleep(Math.min(5000, deadline - Date.now()));
  }
}

console.log(`[${stamp()}] scheduler stopped after ${cycle} cycle(s).`);
