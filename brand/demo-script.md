# Demo video script

**Target: 2 minutes 20.** Judges are watching many entries. Every second before the first real
thing on screen is a second spent on nothing.

All figures below are live as of 16 Aug and come from `data/scorecard.json` and `data/feed.json`.
Re-check them before recording — if the poller has run, the event count will have moved.

---

## The one decision that shapes this script

Do not sell a prediction engine. **Drift-d measured its own signal and published the result, and
the result was negative.** Every other entry will claim their agent works. This one shows the
receipt either way, and that is the only thing in the video a judge cannot get from a README.

So the arc is: *here is the idea → here it is running → here is what happened when we checked.*
The checking is the ending, not a footnote.

---

## Shot list

### 0:00 — 0:12 · Cold open, no introduction

**Screen:** the hero, full width. The two signal lines are already moving. Let them run for a
beat before speaking — the separation should happen on camera.

> Attention and money move at different speeds.
>
> A token gets loud before the volume shows up. Or the volume moves while nobody's talking.
> Neither number tells you much on its own.

**Direction:** no face, no logo card, no "hi everyone". The animation is the opening title.

---

### 0:12 — 0:22 · Name the job

**Screen:** scroll slightly so the headline and the input sit together.

> Drift-d watches both signals for a Base token and reports the hours they disagree.
> That's the whole product. The gap, and what kind of gap it is.

---

### 0:22 — 0:55 · Run it live

**Screen:** click into the ticker box, type `AERO`, hit Analyse. Let the pipeline steps light up
in real time. Do not cut this — the wait is the proof it is really running.

> This is live. It pulls a week of social history, the same week of pool volume from Base,
> ranks each against its own past, and subtracts them.

**Screen:** result lands. Point at the score and the direction label.

> Social rank, onchain rank, and the gap between them. Then Claude explains which kind of gap
> it is — reading the numbers, never computing them.

**Screen:** hover the BaseScan line under the result.

> The pool is matched by ticker, which doesn't prove identity, so every result ships its own
> pool address to check.

**If the lookup fails on camera:** do not re-record. Say *"that's the social data provider being
down — the recorded feed below is unaffected"*, and scroll to the feed. Handling a failure
honestly on camera is worth more than a clean take.

---

### 0:55 — 1:20 · Why the number is trustworthy

**Screen:** section 03, the engine. Scroll slowly past the two lab blocks.

> The engine had three bugs, and all three were found by measuring rather than by reading code.
>
> Percent change blew up to a hundred and seventy-eight thousand on thin pools — that's division
> by almost nothing, not momentum.
>
> And the two axes weren't comparable. Social chatter moves smoothly, pool volume is spiky, so
> subtracting their scores measured the shape of the inputs as much as the gap. Ranking each
> against its own history fixed it: the social-to-onchain split went from three-point-eight to
> one, down to nearly even.

**Direction:** this is the fastest section. Do not linger. It exists to earn the next one.

---

### 1:20 — 2:05 · The scorecard — the actual pitch

**Screen:** section 04. Let the three big numbers land. Pause before speaking.

> Then I did the thing most of these projects don't.
>
> I went back and checked whether the signal was worth anything.

**Screen:** the numbers, one at a time.

> A hundred and thirty-one events. After a divergence fires, the lagging series follows through
> twenty-seven and a half percent of the time.
>
> For any hour picked at random, it's thirty-eight and a half.

**Beat.**

> So flagged hours do worse than random. Minus eleven points of lift. That number is on the
> homepage, at the size of a headline.

**Screen:** scroll to the paragraph naming the likely cause.

> The engine measures exactly what it says it measures. What isn't established is that the
> measurement leads anywhere — and the most likely reason is on the input side: attention is
> global, volume is one Base pool. They describe different markets.
>
> An agent whose claims can't fail isn't making claims. This one can, and did.

---

### 2:05 — 2:20 · Close

**Screen:** scroll through the feed briefly, expand one event, then the footer.

> A hundred and twenty-five recorded events across twelve tokens, every one with its numbers and
> its reasoning, in a public file with timestamps.
>
> Drift-d. Site, code and feed are all linked below.

**End on:** the footer with the two signals converging. No outro card, no music sting.

---

## Recording notes

- **Screen record at 1440p or higher**, then let the platform downscale. Terminal-style type at
  1080p gets mushy.
- **Full-screen the browser and hide bookmarks.** A visible bookmarks bar is the fastest way to
  make a product look like a side project.
- **One take, no jump cuts inside the live lookup.** Cuts there imply the wait was edited out,
  which quietly undermines the "it's really running" claim.
- **Do not add music.** The page is quiet and precise; a track fights it.
- **Say the numbers as words** ("minus eleven points"), not as read-aloud digits. The screen
  already shows the figures.
- If you record before posting to X and Telegram, **do not show the footer links closely** —
  empty channels behind a link are worse on camera than in a browser.

## What to cut if you need it shorter

In this order: the engine section down to one sentence, then the BaseScan line, then the feed
scroll at the end. **Never cut the scorecard.** If the video is ninety seconds, it should be the
cold open, the live lookup, and the scorecard, and nothing else.

## What not to say

- Don't call a divergence a buy or sell signal. It is an observation about two data series.
- Don't say the agent "predicts" anything — the scorecard is on screen saying otherwise, and a
  judge who notices the contradiction stops believing the rest.
- Don't apologise for the negative result or hedge it with "but with more data...". State it and
  move on. The confidence is the point.
