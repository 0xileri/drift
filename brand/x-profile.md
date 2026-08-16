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
I measure the gap between what people say about a Base token and what the money actually does. 92 events logged so far, each one explained.
```

Recommendation: **A**. It states the insight rather than the implementation, and the insight is
the part that is actually unusual. B is the better second choice if the audience is technical.

## Website field

```
https://drift-divergence.netlify.app
```

---

## Pinned post

Leads with a real recorded event rather than a claim about capability. The whole project rests
on figures tracing to real calls, so the launch post should be checkable too — the event below
is in the public feed with its timestamp.

### Single post (preferred) — 277 chars

X counts any URL as 23 characters no matter its real length, so the link costs less than it
looks. Under 280 without Premium, with the organiser tag included.

```
Most token tools tell you what's getting loud.

24 Jul: VIRTUAL's onchain volume spiked as social engagement collapsed. Divergence -11.8 — money moving while nobody talked.

Drift-d watches that gap on Base. 92 events, 5 tokens.

Built for @Orion_Agents
drift-divergence.netlify.app
```

**Tighter variant — 267 chars**, if you want headroom to edit before posting:

```
Most token tools tell you what's loud.

24 Jul: VIRTUAL's onchain volume spiked as social engagement collapsed. Divergence -11.8 — money moving while nobody talked.

Drift-d finds that gap on Base. 92 events, 5 tokens.

@Orion_Agents hackathon
drift-divergence.netlify.app
```

Tagging costs about 25 characters once the line break is counted, which is why the sentences
above are tighter than the untagged draft. The tag is worth it — entries are partly judged on
community upvotes from registered builders, and the organiser account is how they find you.

Attach `brand/drift-d-lockup-dark-1600.png` or a screenshot of the feed section.

### Thread version

**1/**
```
Most token tools tell you what's getting loud.

Drift-d watches for something different: the hours when social attention and onchain money stop
agreeing — in either direction.

92 events across 5 Base tokens over 4 weeks.
```

**2/**
```
The gap runs both ways.

61 events: social ahead of the money. Attention arriving before volume does — early signal, or
a paid pump.

31 events: money ahead of the attention. Volume moving while the timeline stays quiet.

The second kind is the one nobody watches for.
```

**3/**
```
Sharpest reading so far: VIRTUAL, 24 Jul, -11.8.

Onchain interval volume spiked hard. Social engagement collapsed at the same hour.

No one was talking. The money did not care.
```

**4/**
```
The score is deterministic — median/MAD z-scores on log-ratio momentum, no model involved.

The threshold was measured, not guessed: replayed against 3,292 real scored hours to land on a
rate a person can actually read.

Claude explains the number. It never computes it.
```

**5/**
```
Every figure traces to a real API call, and the event feed is a public file with timestamps —
so you can check what it said and when, rather than trusting a demo.

Built for the @Orion_Agents builder hackathon on Base.

Site: drift-divergence.netlify.app
Code: github.com/0xileri/drift
```

---

## Notes before posting

- **Organiser handle is `@Orion_Agents`**, confirmed by the builder rather than guessed. Worth a
  glance at the profile before posting anyway — a launch post is the worst place to discover a
  typo'd tag pointing at an unrelated account.
- **Say nothing that reads as advice.** A divergence is an observation about two data series.
  Framing it as a buy or sell signal invites a category of reply you do not want, and is not
  what the agent does.
- **The live lookup is paused** while the social data subscription is inactive. If you post
  before renewing, expect someone to try it — the page says so plainly, but it is better to
  renew first so the first impression is the working one.
