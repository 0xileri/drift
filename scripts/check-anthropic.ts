/**
 * Verifies the narration layer end to end: key is valid, the model id resolves, and Claude
 * returns usable prose for a realistic divergence payload.
 *
 * Uses a synthetic event rather than live data so it can run before backfill, and so the input
 * is a known shape - if the output misreads it, the prompt is wrong, not the data.
 *
 * Never prints the key.
 *
 *   npm run check:anthropic
 */
import "dotenv/config";

const key = process.env.ANTHROPIC_API_KEY;

if (!key) {
  console.error(
    "ANTHROPIC_API_KEY is not set.\n" +
      "Add it to .env (get one at https://console.anthropic.com), then re-run."
  );
  process.exit(1);
}
if (!key.startsWith("sk-ant-")) {
  console.warn(`Warning: key does not start with "sk-ant-" - check it was copied whole.\n`);
}

console.log(`Key loaded (length ${key.length}). Testing narration...\n`);

const { narrateDivergence } = await import("../src/narration/narrate.js");

/** A social-ahead-of-onchain event: attention spiking while volume stays flat. */
const snapshot = {
  token: "TESTCOIN",
  timestampMs: Date.now(),
  social: { galaxyScore: 68, altRank: 412, sentiment: 81, socialVolume: 14200 },
  onchain: {
    priceUsd: 0.0431,
    intervalVolumeUsd: 38_500,
    volume24hUsd: 910_000,
    liquidityUsd: 1_240_000,
    txns24h: 3120,
  },
};

const divergence = {
  token: "TESTCOIN",
  timestampMs: snapshot.timestampMs,
  sufficientHistory: true,
  socialMomentumLogRatio: 1.12, // ~3x jump in interactions
  onchainMomentumLogRatio: 0.04, // essentially flat volume
  socialZ: 4.1,
  onchainZ: 0.2,
  divergenceScore: 3.9,
  significant: true,
};

try {
  const text = await narrateDivergence(snapshot, divergence, null);

  if (!text.trim()) {
    console.error("FAIL: call succeeded but returned empty text.");
    process.exit(1);
  }

  console.log("Narration returned:\n");
  console.log(text.trim().replace(/^/gm, "  "));
  console.log("\n" + "-".repeat(70));

  // The prompt tells Claude these are log ratios; describing 1.12 as "1.12%" means it didn't take.
  const misread = /1\.12\s*%|0\.04\s*%/.test(text);
  console.log(
    misread
      ? "WARNING: output looks like it read log ratios as percentages - check the prompt."
      : "VERDICT: narration layer works. Log ratios were not misread as percentages."
  );
} catch (err) {
  const msg = (err as Error).message;
  console.error(`FAIL: ${msg}\n`);
  if (/401|authentication/i.test(msg)) console.error("  -> Key rejected. Check it was copied whole.");
  else if (/credit|balance|400/i.test(msg)) console.error("  -> Likely no credit on the account.");
  else if (/model/i.test(msg)) console.error("  -> Model id may be wrong; check src/narration/narrate.ts.");
  process.exit(1);
}
