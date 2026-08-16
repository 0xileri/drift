# X profile copy

Drafts for the Drift-d account. Nothing here has been posted — every option is yours to pick,
edit, or discard.

Character counts are given because X truncates silently: a bio that runs long is cut mid-word
in the preview card, and a name over 50 is rejected outright.

---

## Profile picture

`brand/drift-d-mark-light-1024.png` (or the dark variant).

X crops to a circle at 400×400 minimum. These carry ~28% padding so the crop never clips the
mark.

## Header image

`brand/drift-d-lockup-dark-1600.png` sits well behind the avatar. X headers are 1500×500 and
the bottom-left is covered by the profile picture, so the lockup being centred is deliberate.

## Name (50 char limit)

```
Drift-d
```
7 chars. Resist appending a tagline — the bio directly underneath is where that belongs, and a
name carrying its own explainer reads as filler.

## Bio (160 char limit)

**Option A — the thesis** (139 chars)
```
Attention and money move at different speeds. I watch Base tokens and report the hours they disagree — with the reasoning, not just a score.
```

**Option B — the mechanism** (158 chars)
```
An agent that flags when a Base token's social volume and its onchain volume stop agreeing, then explains the gap. Every figure traces to a real API call.
```

**Option C — the evidence** (144 chars)
```
I measure the gap between what people say about a Base token and what the money actually does. 125 events logged, each one explained and checked.
```

Recommendation: **A**. It states the insight rather than the implementation, and the insight is
the part that is actually unusual. B is the better second choice if the audience is technical.

## Website field

```
https://drift-divergence.netlify.app
```

---

## Pinned post

Rewritten around the scorecard. The earlier draft led with "divergence -11.8", a figure that no
longer exists: after the rank transform scores are bounded to +/-2, and the largest event in the
current feed is -2.00. Posting it would have sent readers to a site showing a different scale.

Leading with the negative result is also the stronger post. Every entry in that gallery claims
its agent works; none of them publish a miss rate.

All three fit without X Premium. X counts any URL as 23 characters regardless of its real length,
so the link costs less than it looks.

### Option C - 266 chars (recommended)

```
Every hackathon agent claims it works.

Mine publishes its own miss rate.

131 events across 12 Base tokens. Flagged hours follow through 27.5% of the time. Random hours: 38.5%.

-11 points of lift, printed at headline size.

drift-divergence.netlify.app
```

### Option A - 278 chars

```
Most crypto agents tell you they work.

I measured mine.

131 divergence events on Base. After one fires, the lagging signal follows through 27.5% of the time.

Random hours: 38.5%.

Worse than chance - and it's the headline on my site.

drift-divergence.netlify.app
```

### Option B - 273 chars (explains the product first)

Softer entry if you would rather not open on a negative result.

```
I built an agent that spots when a Base token's hype and its onchain volume stop agreeing.

Then I checked whether the signal was worth anything.

27.5% follow-through vs 38.5% for random hours.

On the homepage, not in a footnote.

drift-divergence.netlify.app
```

**Attach**: `brand/drift-d-lockup-dark-1600.png`, or a screenshot of the scorecard section - the
three large numbers photograph well.

### Thread version

**1/**
```
Most token tools tell you what's getting loud.

Drift-d watches for something else: the hours when social attention and onchain money stop
agreeing - in either direction.

125 events across 12 Base tokens.
```

**2/**
```
The gap runs both ways.

72 events: attention ahead of the money.
53 events: money moving while the timeline stays quiet.

The second kind is the one nobody watches for.
```

**3/**
```
Each axis is ranked against its own history before they're compared.

Subtracting raw scores measured the shape of the inputs instead of the gap - social chatter moves
smoothly, pool volume is spiky, and the threshold sat where only one side could reach it.
```

**4/**
```
Thin pools were the other trap.

A ratio between two tiny numbers is noise wearing a plausible score. One event scored 6.17 on
volume going from $3,953 to a single cent.

There's now a floor set per pool, not in dollars.
```

**5/**
```
Then I checked whether any of it predicts anything.

131 events. Flagged hours follow through 27.5% of the time. Random hours: 38.5%.

Worse than chance. It's on the homepage at headline size.

An agent whose claims can't fail isn't making claims.
```

**6/**
```
Site: drift-divergence.netlify.app
Code: github.com/0xileri/drift

Every event is in a public file with timestamps, so you can check what it said and when.

Built for @Orion_Agents' builder hackathon on Base.
```

## Notes before posting

- **Organiser handle is `@Orion_Agents`**, confirmed by the builder rather than guessed. Worth a
  glance at the profile before posting anyway — a launch post is the worst place to discover a
  typo'd tag pointing at an unrelated account.
- **Say nothing that reads as advice.** A divergence is an observation about two data series.
  Framing it as a buy or sell signal invites a category of reply you do not want, and is not
  what the agent does.
- **Check the live lookup right before posting.** The social data plan bills daily and has
  lapsed twice already, each time returning a 402 that pauses the lookup. The page handles it
  honestly, but the first thing a reader does is type a ticker, and that should work.
- **Re-read the numbers against `data/scorecard.json`** on the day you post. The poller runs
  hourly, so the event count moves and a quoted figure goes stale quietly.
