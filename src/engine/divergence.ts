import {
  DIVERGENCE_THRESHOLD,
  MIN_HISTORY_FOR_ZSCORE,
  MIN_INTERVAL_VOLUME_USD,
  MIN_INTERVAL_VOLUME_FRACTION,
} from "../config.js";
import type { DivergenceResult, PollSnapshot } from "../types.js";

/** Guards against divide-by-near-zero on quiet hours in thin pools. */
const EPSILON = 1e-9;

/** Robust z-scores are capped here; beyond this the exact value carries no extra meaning. */
const MAX_Z = 10;

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

/** Median absolute deviation - the outlier-resistant analogue of standard deviation. */
function medianAbsoluteDeviation(values: number[], med: number): number {
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * Robust (modified) z-score, built on median/MAD instead of mean/stddev.
 *
 * The momentum distributions on real pools are heavily fat-tailed (median |z| ~0.1 against a p99
 * of ~3.4). With mean/stddev, a single spike inflates the baseline it is being measured against
 * and suppresses every subsequent real signal. Median/MAD keeps the baseline stable.
 * The 0.6745 factor rescales MAD so the result is comparable to a conventional z-score.
 */
function robustZScore(value: number, baseline: number[]): number {
  const med = median(baseline);
  const mad = medianAbsoluteDeviation(baseline, med);

  if (mad === 0) {
    // A flat baseline gives no scale to measure against; report direction only.
    if (Math.abs(value - med) < EPSILON) return 0;
    return Math.sign(value - med) * MAX_Z;
  }

  const z = (0.6745 * (value - med)) / mad;
  return Math.max(-MAX_Z, Math.min(MAX_Z, z));
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
 * Rescales an axis so a given z means the same rarity on both sides of the subtraction.
 *
 * Median/MAD normalisation equalises the BODY of the two distributions - measured over 3,297
 * hours, median |z| was 0.75 for social and 0.74 for onchain. The tails do not match: p99 was
 * 7.16 social against 4.82 onchain. The threshold sits at 6.0, inside exactly that gap, so
 * before this correction only the social axis could reach it. Every one of the 54 events under
 * the new floor classified as social-driven, and none as onchain-driven - not because Base
 * tokens behave that way, but because subtracting two differently-tailed scores measures the
 * shape of the inputs as much as the gap between them.
 *
 * Dividing each axis by its own upper-decile |z| makes 1.0 mean "a p90 move for this series",
 * which is the comparison the score was always claiming to make.
 */
function tailScale(baseline: number[]): number {
  if (baseline.length < 10) return 1;
  const med = median(baseline);
  const mad = medianAbsoluteDeviation(baseline, med);
  if (mad === 0) return 1;

  const zs = baseline.map((v) => Math.abs((0.6745 * (v - med)) / mad)).sort((a, b) => a - b);
  const p90 = zs[Math.floor((zs.length - 1) * 0.9)];
  // Guard against a degenerate baseline collapsing the scale and inflating every later score.
  return p90 > 0.5 ? p90 : 1;
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
  socialZ: number,
  onchainZ: number,
  socialLR: number,
  onchainLR: number
): NonNullable<DivergenceResult["direction"]> {
  const socialDominant = Math.abs(socialZ) >= Math.abs(onchainZ);
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
      socialZ: null,
      onchainZ: null,
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
      socialZ: null,
      onchainZ: null,
      direction: null,
      suppressedReason: null,
      divergenceScore: null,
      significant: false,
    };
  }

  const socialZ = robustZScore(latestSocialMomentum, priorSocial);
  const onchainZ = robustZScore(latestOnchainMomentum, priorOnchain);

  // Subtracting raw z-scores compares two differently-tailed scales; see tailScale above.
  const socialScale = tailScale(priorSocial);
  const onchainScale = tailScale(priorOnchain);
  const divergenceScore = socialZ / socialScale - onchainZ / onchainScale;

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
    socialZ,
    onchainZ,
    direction: classify(
      socialZ / socialScale,
      onchainZ / onchainScale,
      latestSocialMomentum,
      latestOnchainMomentum
    ),
    suppressedReason,
    divergenceScore,
    // A suppressed reading keeps its score for continuity in the series, but never becomes an
    // event - the number is arithmetically fine and epistemically worthless.
    significant: suppressedReason === null && Math.abs(divergenceScore) >= DIVERGENCE_THRESHOLD,
  };
}

