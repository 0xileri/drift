import { DIVERGENCE_THRESHOLD, MIN_HISTORY_FOR_ZSCORE } from "../config.js";
import type { DivergenceResult, PollSnapshot } from "../types.js";

/** Guards against divide-by-near-zero on quiet hours in thin pools. */
const EPSILON = 1e-9;

/** Robust z-scores are capped here; beyond this the exact value carries no extra meaning. */
const MAX_Z = 10;

/**
 * Log ratio rather than percent change.
 *
 * Percent change is unbounded as `prev` approaches zero -” measured against real Base pools, a
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

/** Median absolute deviation -” the outlier-resistant analogue of standard deviation. */
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
 * Deliberately NOT volume24hUsd -” a rolling 24h figure overlaps itself between consecutive polls,
 * which smears real momentum and would make the z-score baseline incomparable to backfilled data.
 * Both the backfill and live paths must populate intervalVolumeUsd from the same hourly bucket.
 */
function onchainMetric(s: PollSnapshot): number | null {
  return s.onchain.intervalVolumeUsd;
}

/**
 * Compares social momentum against onchain momentum and returns how far apart they are,
 * in standard deviations, relative to that token's own history. This is the deterministic
 * core of the agent -” no LLM involved. `history` must be oldest-first and include the
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
      divergenceScore: null,
      significant: false,
    };
  }

  const socialZ = robustZScore(latestSocialMomentum, priorSocial);
  const onchainZ = robustZScore(latestOnchainMomentum, priorOnchain);
  const divergenceScore = socialZ - onchainZ;

  return {
    token,
    timestampMs: latest.timestampMs,
    sufficientHistory: true,
    socialMomentumLogRatio: latestSocialMomentum,
    onchainMomentumLogRatio: latestOnchainMomentum,
    socialZ,
    onchainZ,
    divergenceScore,
    significant: Math.abs(divergenceScore) >= DIVERGENCE_THRESHOLD,
  };
}

