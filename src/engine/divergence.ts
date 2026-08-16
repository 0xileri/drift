import {
  DIVERGENCE_THRESHOLD,
  MIN_HISTORY_FOR_ZSCORE,
  MIN_INTERVAL_VOLUME_USD,
  MIN_INTERVAL_VOLUME_FRACTION,
} from "../config.js";
import type { DivergenceResult, PollSnapshot } from "../types.js";

/** Guards against divide-by-near-zero on quiet hours in thin pools. */
const EPSILON = 1e-9;

/**
 * Log ratio rather than percent change.
 *
 * Percent change is unbounded as `prev` approaches zero - measured against real Base pools, a
 * quiet hour followed by an active one produced |z| values as high as 178,000, which is
 * division-by-almost-zero, not momentum. Log ratio is symmetric (a doubling and a halving are
 * equal and opposite) and stays finite, which matters because the thin, low-volume pools where
 * this artifact appears are exactly the ones the agent is meant to watch.
 */
function logRatio(prev: number | null, curr: number | null): number | null {
  if (prev === null || curr === null) return null;
  if (prev < 0 || curr < 0) return null;
  return Math.log((curr + EPSILON) / (prev + EPSILON));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Primary social momentum metric: social volume (falls back to galaxy score if unavailable). */
function socialMetric(s: PollSnapshot): number | null {
  return s.social.socialVolume ?? s.social.galaxyScore;
}

/**
 * Onchain momentum metric: per-interval (hourly) pool volume from GeckoTerminal.
 *
 * Deliberately NOT volume24hUsd - a rolling 24h figure overlaps itself between consecutive polls,
 * which smears real momentum and would make the z-score baseline incomparable to backfilled data.
 * Both the backfill and live paths must populate intervalVolumeUsd from the same hourly bucket.
 */
function onchainMetric(s: PollSnapshot): number | null {
  return s.onchain.intervalVolumeUsd;
}

/**
 * Where this move sits in its own series' history, as a signed fraction of [-1, 1].
 *
 * This replaces quantile scaling, which only matched the two axes at the single quantile it was
 * tuned to. A percentile is uniform on [0,1] by construction, so BOTH axes now match at every
 * quantile - +0.98 means "larger than 98% of this series' own moves" whether the series is dense
 * social chatter or spiky pool volume. That is the comparison the subtraction always claimed to
 * be making, and the first version that actually makes it.
 *
 * Ties count as half, so a move equal to much of its baseline does not jump the whole block.
 */
function signedPercentile(value: number, baseline: number[]): number {
  if (baseline.length === 0) return 0;

  const magnitude = Math.abs(value);
  let below = 0;
  let equal = 0;
  for (const b of baseline) {
    const m = Math.abs(b);
    if (m < magnitude) below++;
    else if (m === magnitude) equal++;
  }

  const pct = (below + equal / 2) / baseline.length;
  return Math.sign(value) * pct;
}

/**
 * Names which series drove the gap and which way it moved.
 *
 * Derived from the larger |z| rather than from the sign of the score, because the sign only says
 * which side is higher - not which side moved. When both series fall and social falls faster,
 * the score is negative, which a two-label scheme reports as "onchain ahead" even though onchain
 * also declined.
 */
function classify(
  socialRank: number,
  onchainRank: number,
  socialLR: number,
  onchainLR: number
): NonNullable<DivergenceResult["direction"]> {
  const socialDominant = Math.abs(socialRank) >= Math.abs(onchainRank);
  const lr = socialDominant ? socialLR : onchainLR;
  const side = socialDominant ? "social" : "onchain";
  return `${side}-${lr >= 0 ? "rising" : "falling"}` as NonNullable<DivergenceResult["direction"]>;
}

/**
 * Whether both hours carry enough volume for their ratio to be informative.
 * `baseline` is the token's prior interval volumes, used for the relative floor.
 */
function volumeTooThin(
  prev: number | null,
  curr: number | null,
  baseline: number[]
): string | null {
  if (prev === null || curr === null) return null;

  const med = baseline.length ? median(baseline.filter((v) => Number.isFinite(v))) : 0;
  const floor = Math.max(MIN_INTERVAL_VOLUME_USD, med * MIN_INTERVAL_VOLUME_FRACTION);
  const smaller = Math.min(prev, curr);

  if (smaller >= floor) return null;
  return (
    `interval volume $${smaller.toFixed(2)} is below the $${floor.toFixed(0)} floor ` +
    `(${(MIN_INTERVAL_VOLUME_FRACTION * 100).toFixed(0)}% of this pool's $${med.toFixed(0)} median), ` +
    `so the ratio carries no information`
  );
}

/**
 * Compares social momentum against onchain momentum and returns how far apart they are,
 * in standard deviations, relative to that token's own history. This is the deterministic
 * core of the agent - no LLM involved. `history` must be oldest-first and include the
 * current poll as the last element.
 */
export function computeDivergence(token: string, history: PollSnapshot[]): DivergenceResult {
  const latest = history[history.length - 1];

  if (history.length < 2) {
    return {
      token,
      timestampMs: latest.timestampMs,
      sufficientHistory: false,
      socialMomentumLogRatio: null,
      onchainMomentumLogRatio: null,
      socialRank: null,
      onchainRank: null,
      direction: null,
      suppressedReason: null,
      divergenceScore: null,
      significant: false,
    };
  }

  const socialMomentum: number[] = [];
  const onchainMomentum: number[] = [];
  for (let i = 1; i < history.length; i++) {
    socialMomentum.push(logRatio(socialMetric(history[i - 1]), socialMetric(history[i])) ?? NaN);
    onchainMomentum.push(logRatio(onchainMetric(history[i - 1]), onchainMetric(history[i])) ?? NaN);
  }

  const latestSocialMomentum = socialMomentum[socialMomentum.length - 1];
  const latestOnchainMomentum = onchainMomentum[onchainMomentum.length - 1];

  const priorSocial = socialMomentum.slice(0, -1).filter((v) => !Number.isNaN(v));
  const priorOnchain = onchainMomentum.slice(0, -1).filter((v) => !Number.isNaN(v));

  const sufficientHistory =
    priorSocial.length >= MIN_HISTORY_FOR_ZSCORE &&
    priorOnchain.length >= MIN_HISTORY_FOR_ZSCORE &&
    !Number.isNaN(latestSocialMomentum) &&
    !Number.isNaN(latestOnchainMomentum);

  if (!sufficientHistory) {
    return {
      token,
      timestampMs: latest.timestampMs,
      sufficientHistory: false,
      socialMomentumLogRatio: Number.isNaN(latestSocialMomentum) ? null : latestSocialMomentum,
      onchainMomentumLogRatio: Number.isNaN(latestOnchainMomentum) ? null : latestOnchainMomentum,
      socialRank: null,
      onchainRank: null,
      direction: null,
      suppressedReason: null,
      divergenceScore: null,
      significant: false,
    };
  }

  // Each side is ranked within its OWN history, so the two are directly comparable before they
  // are subtracted. Reported as-is, which keeps socialRank - onchainRank === divergenceScore
  // checkable in one subtraction.
  const socialRank = signedPercentile(latestSocialMomentum, priorSocial);
  const onchainRank = signedPercentile(latestOnchainMomentum, priorOnchain);
  const divergenceScore = socialRank - onchainRank;

  // Volumes for the two hours this reading compares, plus the pool's own prior volumes as the
  // yardstick for "too thin".
  const volumes = history.map((h) => h.onchain.intervalVolumeUsd).filter((v): v is number => v != null);
  const suppressedReason = volumeTooThin(
    history[history.length - 2].onchain.intervalVolumeUsd,
    latest.onchain.intervalVolumeUsd,
    volumes.slice(0, -2)
  );

  return {
    token,
    timestampMs: latest.timestampMs,
    sufficientHistory: true,
    socialMomentumLogRatio: latestSocialMomentum,
    onchainMomentumLogRatio: latestOnchainMomentum,
    socialRank,
    onchainRank,
    direction: classify(socialRank, onchainRank, latestSocialMomentum, latestOnchainMomentum),
    suppressedReason,
    divergenceScore,
    // A suppressed reading keeps its score for continuity in the series, but never becomes an
    // event - the number is arithmetically fine and epistemically worthless.
    significant: suppressedReason === null && Math.abs(divergenceScore) >= DIVERGENCE_THRESHOLD,
  };
}

