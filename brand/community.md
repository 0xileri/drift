# Community channel copy

Drafts for the Telegram channel copy.

**Live links**
- Telegram: https://t.me/+Vx2_CS29IhEzNTY0
- Project X: https://x.com/drift_diverg
- Builder: @0xileri (X) · @oxileri (Telegram)
- Orion organisers: @Orion_Agents

Both links are wired into the site footer.

---

## Which one

**Telegram, and it isn't close for your situation.**

A Discord server judged on its own looks empty unless it has members and activity. Channels sit
there unread, and a server with four categories and no conversation reads worse than no server
at all. Setting it up is also a half-hour of roles and permissions you do not have to spend.

A Telegram **channel** (broadcast, not a group) is honest at any size: it is a feed, so nobody
expects a conversation in it. You can create one in about two minutes, and it degrades
gracefully — a channel with a handful of posts and no members still reads as a working
publication, where an empty Discord reads as abandoned.

Create Telegram → New Channel → Public.

---

## Telegram

### Channel name (128 char limit)

```
Drift-d
```

### Public link (5–32 chars, letters/digits/underscores)

```
driftd_agent
```
If taken, in order of preference: `drift_divergence`, `driftd_base`, `driftd_signals`.
Avoid anything with "official" or "announcements" — it reads as filler on a project this size.

### Description (255 char limit) — 252 chars

```
Watches when a Base token's social attention and onchain money stop agreeing, and explains the gap.

Deterministic scores, explained by Claude. Every figure traces to a real API call.

Built for the Orion builder hackathon.
drift-divergence.netlify.app
```

Shorter alternative — 148 chars, if you prefer the description to fit without scrolling on
mobile:

```
Attention and money move at different speeds. This channel posts the hours they disagree on Base — with the reasoning.

drift-divergence.netlify.app
```

### Profile photo

`brand/drift-d-mark-light-512.png` (or the dark variant). Telegram crops to a circle, same as X,
and these carry the padding for it.

### Pinned message

Telegram has no 280-character limit, so this can carry more than the X post — but a wall of text
in a pinned message goes unread. This is deliberately scannable.

```
Drift-d — what this channel is

Attention and money move at different speeds.

A token can get loud before real volume shows up. It can also move serious volume while almost
nobody is talking about it. Neither number means much alone — the information is in the
disagreement between them.

This agent watches both signals for Base tokens and posts the hours they come apart.

How a reading is produced
• Social momentum — interactions per hour, aggregated across X, Reddit, YouTube, TikTok
• Onchain momentum — hourly volume for the token's own Base pool
• A deterministic engine scores the gap. No model is involved in the number.
• Claude explains what kind of gap it is. It never computes the score.

Where it stands
92 events across 5 tokens over 4 weeks. 61 were attention arriving ahead of the money; 31 were
money moving while the timeline stayed quiet. The second kind is the one nobody watches for.

Sharpest so far: VIRTUAL, 24 Jul, divergence -11.8. Onchain volume spiked, social engagement
collapsed in the same hour.

Check it yourself
Site — drift-divergence.netlify.app
Code — github.com/0xileri/drift
The event feed is a public file with timestamps, so you can check what the agent said and when.

Not advice. A divergence is an observation about two data series, nothing more.
```

---

## Discord (only if you specifically want one)

### Server name
```
Drift-d
```

### Server description (120 char limit) — 108 chars
```
An agent that flags when a Base token's social attention and onchain volume stop agreeing, and explains the gap.
```

### Channel structure

Keep it to three. More channels on a new server means more empty rooms.

```
#start-here     — the welcome message below, locked to read-only
#feed           — divergence events, read-only
#discussion     — the only channel anyone can post in
```

### #start-here message

```
**Drift-d**

Attention and money move at different speeds. A token can get loud before volume shows up, or
move real volume while nobody is talking. The signal is in the gap between them, and that gap
is the only thing this agent reports.

**How a reading is produced**
Social momentum from interactions per hour. Onchain momentum from hourly volume in the token's
own Base pool. A deterministic engine scores the gap — no model touches the number. Claude then
explains what kind of gap it is.

**Where it stands**
92 events across 5 tokens over 4 weeks. 61 attention-ahead, 31 money-ahead.

**Check it yourself**
Site — https://drift-divergence.netlify.app
Code — https://github.com/0xileri/drift

Not advice. A divergence is an observation about two data series.
```

---

## Notes before creating

- **Use the same handle everywhere you can.** If `driftd_agent` is free on Telegram, take the
  matching X handle even if you post under a different display name.
- **Put the link in the site footer once it exists.** The footer currently has a disabled
  placeholder; send me the URL and I will wire it in and redeploy.
- **A channel with three posts beats a channel with none.** Post the pinned message, then two or
  three real events from the feed before you submit, so a judge clicking through sees output
  rather than an empty room.
