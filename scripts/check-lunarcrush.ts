/**
 * Verifies the LunarCrush key works AND that your plan tier actually includes the time-series
 * endpoint — the one carrying `interactions` and `sentiment`, which the divergence engine needs.
 *
 * This is the $5/day vs $15/day question: the Individual plan is documented as "limited
 * endpoints" without saying which, so the only reliable answer is an authenticated call.
 *
 * Never prints the key.
 *
 *   npm run check:lunarcrush [SYMBOL]
 */
import "dotenv/config";

const symbol = process.argv[2] ?? "ETH";
const key = process.env.LUNARCRUSH_API_KEY;

if (!key) {
  console.error("LUNARCRUSH_API_KEY is not set. Add it to .env, then re-run.");
  process.exit(1);
}

console.log(`Key loaded (length ${key.length}). Testing as ${symbol}.\n`);

async function probe(label: string, url: string) {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  } catch (err) {
    console.log(`${label}\n  NETWORK ERROR: ${(err as Error).message}\n`);
    return null;
  }

  const remaining = res.headers.get("x-ratelimit-remaining");
  const limit = res.headers.get("x-ratelimit-limit");
  const quota = [limit && `limit ${limit}`, remaining && `remaining ${remaining}`]
    .filter(Boolean)
    .join(", ");

  console.log(`${label}\n  HTTP ${res.status} ${res.statusText}${quota ? `  (${quota})` : ""}`);

  if (res.status === 401) {
    console.log("  -> Key rejected. Check it was copied whole, with no quotes or trailing space.\n");
    return null;
  }
  if (res.status === 402 || res.status === 403) {
    console.log("  -> Authenticated but NOT PERMITTED on your plan tier.\n");
    return null;
  }
  if (res.status === 429) {
    console.log("  -> Rate limited. Wait a moment and re-run.\n");
    return null;
  }
  if (!res.ok) {
    console.log(`  -> Unexpected: ${(await res.text()).slice(0, 200)}\n`);
    return null;
  }

  const body = (await res.json()) as { data?: unknown };
  console.log("  -> OK\n");
  return body.data;
}

const basic = await probe(
  "1. Basic coin endpoint  /coins/:coin/v1",
  `https://lunarcrush.com/api4/public/coins/${symbol}/v1`
);

const series = await probe(
  "2. Time-series endpoint  /coins/:coin/time-series/v2   <-- the one this project needs",
  `https://lunarcrush.com/api4/public/coins/${symbol}/time-series/v2?bucket=hour&interval=1w`
);

console.log("─".repeat(70));

if (!series) {
  console.log(
    basic
      ? "VERDICT: key is valid, but time-series is NOT available on this tier.\n" +
          "         The engine cannot run on social data without it — upgrade to Builder ($15/day)."
      : "VERDICT: could not reach the API at all. Resolve the errors above first."
  );
  process.exit(1);
}

const points = Array.isArray(series) ? series : [];
console.log(`VERDICT: time-series IS available. ${points.length} points returned.`);

if (points.length === 0) {
  console.log("But zero data points came back — try a different symbol to confirm.");
  process.exit(1);
}

const latest = points[points.length - 1] as Record<string, unknown>;
const needed = ["interactions", "sentiment", "galaxy_score", "alt_rank"];
const present = needed.filter((f) => latest[f] !== undefined && latest[f] !== null);
const missing = needed.filter((f) => !present.includes(f));

console.log(`\nFields the engine reads: ${present.join(", ") || "(none)"}`);
if (missing.length) console.log(`MISSING / null:          ${missing.join(", ")}`);

const first = points[0] as Record<string, number>;
const span =
  typeof first.time === "number" && typeof (latest.time as number) === "number"
    ? ((latest.time as number) - first.time) / 3600
    : null;
if (span !== null) console.log(`History span requested 1w: ${span.toFixed(0)} hourly points`);

console.log(
  missing.length === 0
    ? "\nAll required fields present — you're clear to run `npm run backfill`."
    : "\nSome fields are missing; the engine will fall back where it can, but check the tier."
);
