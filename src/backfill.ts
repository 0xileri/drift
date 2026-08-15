/**
 * Seeds each watched token's history from real past data instead of waiting weeks for polling
 * to accumulate a baseline.
 *
 * Social history comes from LunarCrush time-series (paid); onchain history from GeckoTerminal
 * OHLCV (free). Both are bucketed hourly, so they're joined on the hour boundary. Hours where
 * either side is missing are dropped rather than interpolated — a fabricated midpoint would
 * become a baseline the z-scores are measured against, so a shorter honest series beats a
 * longer invented one.
 *
 * Overwrites any existing history file for the token. Run before the first live poll.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HISTORY_DIR, watchlist } from "./config.js";
import { fetchSocialHistory, dropIncompleteBucket } from "./sources/lunarcrush.js";
import { fetchPoolHistory } from "./sources/geckoterminal.js";
import type { PollSnapshot } from "./types.js";

const HOUR_MS = 60 * 60 * 1000;

function floorToHour(timestampMs: number): number {
  return Math.floor(timestampMs / HOUR_MS) * HOUR_MS;
}

async function backfillToken(watched: (typeof watchlist)[number]): Promise<void> {
  const symbol = watched.symbol;

  // Sequential, not Promise.all: the LunarCrush client throttles itself, and pairing it with a
  // concurrent GeckoTerminal call just means both providers see bursts.
  const socialSeries = dropIncompleteBucket(
    await fetchSocialHistory(watched.lunarcrushSymbol ?? symbol, "1m", "hour")
  );
  const poolBars = dropIncompleteBucket(
    await fetchPoolHistory(watched.dexscreenerPairAddress, 1000)
  );

  const socialByHour = new Map(
    socialSeries.map((point) => [floorToHour(point.timestampMs), point.social])
  );

  const snapshots: PollSnapshot[] = [];
  let droppedNoSocial = 0;

  for (const bar of poolBars) {
    const hour = floorToHour(bar.timestampMs);
    const social = socialByHour.get(hour);
    if (!social) {
      droppedNoSocial++;
      continue;
    }

    snapshots.push({
      token: symbol,
      timestampMs: hour,
      social,
      onchain: {
        priceUsd: bar.close,
        intervalVolumeUsd: bar.volumeUsd,
        volume24hUsd: null,
        liquidityUsd: null,
        txns24h: null,
      },
    });
  }

  await mkdir(fileURLToPath(HISTORY_DIR), { recursive: true });
  const path = fileURLToPath(new URL(`${symbol}.jsonl`, HISTORY_DIR));
  await writeFile(path, snapshots.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  console.log(
    `[${symbol}] wrote ${snapshots.length} snapshots ` +
      `(${poolBars.length} pool bars, ${socialSeries.length} social points, ` +
      `${droppedNoSocial} bars dropped for missing social)`
  );
  if (first && last) {
    console.log(
      `[${symbol}] range ${new Date(first.timestampMs).toISOString()} → ` +
        `${new Date(last.timestampMs).toISOString()}`
    );
  }
  if (snapshots.length === 0) {
    console.warn(
      `[${symbol}] no overlapping hours — check that the LunarCrush symbol and the pool address ` +
        `refer to the same asset, and that your plan tier returns time-series data.`
    );
  }
}

async function main() {
  if (watchlist.length === 0) {
    console.error("Watchlist is empty. Add verified tokens to src/config.ts first.");
    process.exit(1);
  }

  for (const watched of watchlist) {
    try {
      await backfillToken(watched);
    } catch (err) {
      console.error(`[${watched.symbol}] backfill failed:`, err);
    }
  }
}

main();
