/**
 * Exercises the on-demand path locally, before any of it is exposed over HTTP.
 *
 *   npm run try -- AERO
 *   npm run try -- BRETT --no-narrate      # skips the Claude call
 */
import { analyzeToken, LookupError } from "../src/lookup.js";

const symbol = process.argv[2];
if (!symbol) {
  console.error("Usage: npm run try -- <SYMBOL> [--no-narrate]");
  process.exit(1);
}

const narrate = !process.argv.includes("--no-narrate");
const started = Date.now();

try {
  const r = await analyzeToken(symbol, { narrate });
  const elapsed = Date.now() - started;

  console.log(`\n${r.symbol}  ${r.pool.name}`);
  console.log(`  pool       ${r.pool.address}`);
  console.log(`  liquidity  $${Math.round(r.pool.liquidityUsd).toLocaleString()}`);
  console.log(`  hours      ${r.hoursJoined} joined`);
  console.log(`  bucket     ${new Date(r.bucketMs).toISOString()}`);
  console.log(
    `  scores     social ${r.divergence.socialRank?.toFixed(2)}  ` +
      `onchain ${r.divergence.onchainRank?.toFixed(2)}  ` +
      `divergence ${r.divergence.divergenceScore?.toFixed(2)}` +
      `${r.divergence.significant ? "  [ALERT]" : ""}`
  );
  console.log(`  series     ${r.series.length} points`);
  if (r.narration) console.log(`\n  ${r.narration.replace(/\n/g, "\n  ")}`);
  console.log(`\n  elapsed    ${elapsed}ms${elapsed > 9000 ? "  <-- too slow for a 10s function" : ""}`);
} catch (err) {
  if (err instanceof LookupError) {
    console.error(`\n${err.code} (${err.status}): ${err.message}`);
    process.exit(1);
  }
  throw err;
}
