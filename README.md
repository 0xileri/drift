# Drift-d

An agent that watches when social attention and onchain activity for a token disagree, and explains
why the gap probably matters. Built for the [Orion Builder Hackathon](https://orionagents.org/hackathon)
(Base network).

**Live:** https://drift-divergence.netlify.app

## how it works

1. **social signal** — [LunarCrush](https://lunarcrush.com/developers/api) galaxy score, altrank,
   sentiment, and social volume for a token.
2. **onchain signal** — [DexScreener](https://docs.dexscreener.com/api/reference) price, volume,
   liquidity, and txn count for the same token's Base pair.
3. **divergence engine** (deterministic) — compares social momentum against onchain momentum as a
   z-score gap against that token's own recent history. No LLM involved in this step.
4. **onchain cross-check** — when a divergence event fires, one direct Base RPC call
   (`getReserves()` on the pool contract) verifies the pool's actual reserves against what
   DexScreener reported, instead of trusting the aggregator alone.
5. **narration** (Claude) — reads the divergence score plus every raw input and explains what kind of
   gap it is and what to watch next. It narrates the facts it's given; it doesn't compute the score.

## data sources, and why each one

| Signal | Source | Why |
|---|---|---|
| Social momentum | LunarCrush time-series | Only endpoint carrying `interactions` / `sentiment` |
| Onchain momentum | GeckoTerminal OHLCV | Pool-specific **history** (~41 days hourly), free, enables backfill |
| Liquidity / txn context | DexScreener | Convenient rolling-24h context (not fed into the score) |
| Verification | Base RPC `getReserves()` | Cross-checks aggregator liquidity against contract truth |

The momentum metric is **hourly bucket volume**, never rolling 24h volume — a rolling window
overlaps itself between polls, which smears momentum and makes live snapshots incomparable to
backfilled ones.

## setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `LUNARCRUSH_API_KEY` — from your LunarCrush developer account
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `BASE_RPC_URL` — defaults to the public `mainnet.base.org` endpoint; swap in an Alchemy/other
  provider URL for reliability

Add tokens to watch in `src/config.ts`. Addresses are intentionally left blank — verify each token's
contract and pair address yourself (DexScreener page URL + BaseScan) before adding it; don't trust
addresses from chat or search results.

## running

Seed history from real past data first (needs the LunarCrush key):

```bash
npm run backfill
```

Check the threshold is firing at a sane rate on your actual tokens:

```bash
npm run calibrate -- --watchlist
```

Then poll:

```bash
npm run poll
```

Runs one poll cycle across the watchlist: fetches both signals, appends a snapshot to
`data/history/<TOKEN>.jsonl`, computes divergence once enough history exists (see
`MIN_HISTORY_FOR_ZSCORE` in `src/config.ts`), and narrates + logs to `data/feed.json` when a
divergence crosses `DIVERGENCE_THRESHOLD`.

Run it on a schedule (cron, GitHub Actions, whatever) during the monitoring window leading up to
submission — the demo is the divergence trace building over time, not a backtest.

## project structure

```
src/
  config.ts          watchlist + tunables (thresholds, min history)
  types.ts
  sources/
    lunarcrush.ts     social signal
    dexscreener.ts    onchain signal (price/volume/liquidity)
    baseRpc.ts        direct Base RPC pool-state cross-check
  engine/
    history.ts        append-only per-token snapshot log
    divergence.ts      deterministic z-score gap engine
  narration/
    narrate.ts         Claude narration layer
  runner.ts             orchestrates one poll cycle
data/
  history/              per-token snapshot logs (gitignored)
  feed.json              divergence events with narration (gitignored)
```

## a note on LunarCrush plans

There is **no free API tier**. Plans as listed on lunarcrush.com/pricing:

| Plan | Price | API access |
|---|---|---|
| Individual | $5/day | Limited endpoints, 10 req/min, 2,000/day |
| Builder | $15/day | All endpoints, 100 req/min, 20,000/day |
| Scale | $45/day | All endpoints, 500 req/min, 100,000/day |

The social metrics this agent depends on (`interactions`, `sentiment`) live on the **time-series**
endpoint, not the simpler per-coin endpoint. The docs don't say whether time-series counts as a
"limited endpoint" at the Individual tier — **verified by test that it is available**, so $5/day is
enough and the Builder upgrade isn't needed. Billing is daily, so a short window is viable.

Note the rate limit is enforced by dropping connections rather than returning 429, which surfaces
as `UND_ERR_CONNECT_TIMEOUT` and looks exactly like the host being down. The client throttles to
7s spacing for this reason.

The upside of time-series: historical data is fetchable on demand, so the divergence engine's
baseline can be **backfilled** rather than accumulated by polling for weeks.

## status

**Every stage of the pipeline has now executed against real data.** Done:
- [x] LunarCrush key verified; time-series confirmed available on the Individual tier ($5/day)
- [x] Watchlist screened and populated (AERO, VIRTUAL, KEYCAT, MORPHO, BNKR)
- [x] Backfilled 30 days of joined history — 3,417 snapshots across the five tokens
- [x] Threshold calibrated on real two-axis data (6.0, ~3.3 events/day)
- [x] Narration verified end to end; log ratios correctly read as ratios, not percentages
- [x] Live poll cycle runs, and is idempotent within an hour

Open:
- [ ] Re-verify the pool addresses in `src/config.ts` against BaseScan
- [ ] Observe a real divergence event crossing 6.0 in the live feed (none yet — highest seen 3.30)
- [ ] Scheduler for continuous polling through the deadline
- [ ] Minimal frontend/feed viewer
- [ ] Website, X profile, GitHub repo, Discord/Telegram link for submission

## continuous operation

Two ways to keep it polling:

**GitHub Actions (recommended)** — `.github/workflows/poll.yml` runs hourly and commits any new
divergence events to `data/feed.json`, so the feed becomes a public, timestamped, append-only
record rather than a local file nobody can verify. Requires two repo secrets:

```bash
gh secret set LUNARCRUSH_API_KEY
gh secret set ANTHROPIC_API_KEY
```

Each run rebuilds history from the provider APIs rather than caching it, so a delayed or missed
run is self-healing — there is no state to fall behind.

**Local scheduler** — `npm run schedule` polls at `:05` past each hour and writes to local
history. Only runs while the machine is on; use it for development, not for the demo window.

## operational notes

**Poll on the hour.** Both data sources report the latest *closed* hourly bucket, so the runner
records one row per bucket and skips if that bucket is already present. Polling more often is
harmless but does no work.

**Network faults are frequent and transient.** Both providers intermittently drop TLS connections
mid-request, surfacing as a rotating cast of error codes (`UND_ERR_SOCKET`,
`ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC`, `ERR_SSL_TLSV1_ALERT_DECODE_ERROR`, and others).
`src/sources/http.ts` treats the whole TLS family as retryable rather than enumerating codes,
because enumerating them failed three times in a row on new codes.
- [ ] Minimal frontend/feed viewer
- [ ] Website, X profile, GitHub repo, Discord/Telegram link for submission
