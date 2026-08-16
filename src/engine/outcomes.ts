/**
 * Measures what actually happened after each divergence event.
 *
 * Until now the agent published 92 readings and checked none of them. Every narration ended with
 * some version of "watch the next few intervals" and nobody did. The hourly series is already on
 * disk, so the check costs nothing but was never run - which meant the feed was a set of
 * assertions rather than a set of predictions.
 *
 * Deliberately NOT a claim that the agent predicts price. It measures one thing: after the two
 * series came apart, did the gap close, and if so, which side moved to close it?
 */
import { computeDivergence } from "./divergence.js";
import { DIVERGENCE_THRESHOLD } from "../config.js";
import type { PollSnapshot } from "../types.js";

/** Hours after the event at which the gap is re-measured. */
export const HORIZONS = [3, 6, 12] as const;
export type Horizon = (typeof HORIZONS)[number];

export type Resolution =
  /** The lagging series rose at least 25% above its pre-event baseline. */
  | "followed"
  /** It did not. The gap closed, or did not, without the laggard moving. */
  | "no-follow"
  /** Not enough history either side of the event to judge. */
  | "unknown";

export interface Outcome {
  horizon: Horizon;
  resolution: Resolution;
  scoreAtEvent: number;
  scoreAtHorizon: number | null;
}

/**
 * Did the LAGGING series actually move, in level terms?
 *
 * An earlier version compared z-scores before and after, and reported 94% "faded". That was
 * measuring the wrong thing: a z-score is mean-reverting by construction, so the hour after a
 * spike almost always scores lower simply because the spike has passed. Nearly any event would
 * look like a fade under that test, whatever the underlying series did.
 *
 * This compares LEVELS instead. After a social-led event the question is whether pool volume
 * subsequently rose against its own pre-event baseline - which is the claim the product implies
 * and the only version of it that can be wrong.
 *
 * `lookback` and the horizon window are averaged rather than sampled at a point, so a single
 * noisy hour on either side cannot decide the verdict.
 */
function laggardFollowed(
  history: PollSnapshot[],
  eventIdx: number,
  horizon: number,
  socialLed: boolean
): boolean | null {
  const pick = (s: PollSnapshot) =>
    socialLed ? s.onchain.intervalVolumeUsd : s.social.socialVolume;

  const LOOKBACK = 6;
  const beforeStart = Math.max(0, eventIdx - LOOKBACK);
  const before = history.slice(beforeStart, eventIdx).map(pick).filter((v): v is number => v != null);
  const after = history
    .slice(eventIdx + 1, eventIdx + 1 + horizon)
    .map(pick)
    .filter((v): v is number => v != null);

  if (before.length < 3 || after.length < Math.min(3, horizon)) return null;

  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const b = mean(before);
  const a = mean(after);
  if (b <= 0) return null;

  // 25% above the pre-event baseline. Below that, hourly noise on a thin pool would qualify.
  return a >= b * 1.25;
}

/**
 * Scores every horizon for one event.
 * `history` must contain the event bucket and enough hours after it.
 */
export function outcomesForEvent(
  token: string,
  history: PollSnapshot[],
  eventTimestampMs: number
): Outcome[] {
  const idx = history.findIndex((h) => h.timestampMs === eventTimestampMs);
  if (idx < 0) return [];

  const atEventResult = computeDivergence(token, history.slice(0, idx + 1));
  if (atEventResult.divergenceScore === null) return [];

  const socialLed = (atEventResult.direction ?? "").startsWith("social");

  return HORIZONS.map((h) => {
    const followed = laggardFollowed(history, idx, h, socialLed);
    const later = idx + h < history.length ? computeDivergence(token, history.slice(0, idx + h + 1)) : null;

    return {
      horizon: h,
      resolution: (followed === null ? "unknown" : followed ? "followed" : "no-follow") as Resolution,
      scoreAtEvent: atEventResult.divergenceScore!,
      scoreAtHorizon: later?.divergenceScore ?? null,
    };
  });
}
