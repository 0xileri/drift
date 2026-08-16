/**
 * Injects the event feed into site/index.html between marker comments.
 *
 * The page stays a single self-contained file with no runtime fetch: a browser request to
 * GitHub for feed.json would add an external dependency that can rate-limit, go offline, or be
 * blocked, and the page would silently render empty. Baking the data in at deploy time means the
 * page either ships correct or does not ship.
 *
 *   node scripts/build-site.mjs
 */
import { readFile, writeFile } from "node:fs/promises";

const HTML = "site/index.html";
const FEED = "data/feed.json";
const SCORECARD = "data/scorecard.json";
const START = "<!--FEED:START-->";
const SC_START = "<!--SCORECARD:START-->";
const SC_END = "<!--SCORECARD:END-->";
const END = "<!--FEED:END-->";

const SHOW = 12;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let feed = [];
try {
  feed = JSON.parse(await readFile(FEED, "utf8"));
} catch {
  console.warn(`No ${FEED} found - rendering empty state.`);
}

const sorted = [...feed].sort((a, b) => b.timestampMs - a.timestampMs);
const shown = sorted.slice(0, SHOW);

const fmt = (ms) =>
  new Date(ms).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "UTC", hour12: false,
  });

const tokens = new Set(sorted.map((e) => e.token)).size;
const live = sorted.filter((e) => !e.backfilled).length;

let html;

if (sorted.length === 0) {
  html = `
      <p class="feed-sum">No divergence events recorded yet. The agent polls hourly and posts here
      when a gap crosses the threshold.</p>`;
} else {
  // Opposed bars share a centre line, so the visible gap between the two is the score itself.
  // Ranks are percentiles in [-1, 1]; half the row width represents a full 1.0.
  const bar = (rank, cls) => {
    const w = Math.min(100, Math.abs(rank) * 100);
    const left = rank < 0 ? w : 0;
    const right = rank >= 0 ? w : 0;
    return `<div class="ev-bar ${cls}">` +
      `<span class="l" style="width:${left.toFixed(1)}%"></span>` +
      `<span class="r" style="width:${right.toFixed(1)}%"></span></div>`;
  };

  const cards = shown
    .map((e) => {
      const v = e.divergence;
      const d = v.divergenceScore ?? 0;
      const up = d > 0;
      const sr = v.socialRank ?? 0;
      const or = v.onchainRank ?? 0;
      const dir = (v.direction ?? (up ? "social-rising" : "onchain-rising")).replace("-", " ");
      return `
        <article class="ev ${up ? "up" : "dn"}" data-token="${esc(e.token)}" data-score="${up ? "+" : ""}${d.toFixed(2)}" data-dir="${esc(v.direction ?? "")}">
          <button class="ev-top" type="button" aria-expanded="false">
            <span>
              <span class="ev-tk">${esc(e.token)}</span>
              <span class="ev-dir">${esc(dir)}</span>
            </span>
            <span class="ev-bars" aria-hidden="true">
              ${bar(sr, "a")}
              ${bar(or, "b")}
            </span>
            <span>
              <span class="ev-score">${up ? "+" : ""}${d.toFixed(2)}</span>
              <time class="ev-time" datetime="${new Date(e.timestampMs).toISOString()}">${fmt(e.timestampMs)} UTC</time>
            </span>
          </button>
          <div class="ev-body">
            <p class="ev-n">${esc(e.narration)}</p>
            <div class="ev-m">
              <span>social <b>${sr.toFixed(2)}</b></span>
              <span>onchain <b>${or.toFixed(2)}</b></span>
              ${e.rpcCrossCheck ? `<span>verified at block <b>${esc(e.rpcCrossCheck.blockNumber)}</b></span>` : ""}
              ${e.backfilled ? '<span class="ev-badge" title="Found by replaying recorded history, not by a live poll at the time">replay</span>' : ""}
            </div>
          </div>
        </article>`;
    })
    .join("");

  html = `
      <p class="feed-sum">
        <b>${sorted.length}</b> events across <b>${tokens}</b> tokens${live ? ` · <b>${live}</b> from live polling` : ""}.
        Showing the ${Math.min(SHOW, sorted.length)} most recent.
      </p>
      <div class="events">${cards}
      </div>`;
}

const src = await readFile(HTML, "utf8");
const i = src.indexOf(START);
const j = src.indexOf(END);
if (i === -1 || j === -1) throw new Error(`Markers ${START} / ${END} not found in ${HTML}`);

const out = src.slice(0, i + START.length) + html + "\n      " + src.slice(j);
await writeFile(HTML, out, "utf8");

console.log(`Injected ${shown.length} of ${sorted.length} event(s) into ${HTML}`);

// ---- Scorecard -------------------------------------------------------------
// Injected rather than fetched at runtime, for the same reason as the feed: a page that fetches
// its own evidence can render empty and still look fine.
let sc = null;
try {
  sc = JSON.parse(await readFile(SCORECARD, "utf8"));
} catch {
  console.warn(`No ${SCORECARD} found - skipping scorecard block.`);
}

if (sc) {
  const h6 = sc.horizons["t+6h"];
  const sign = sc.liftT6Points > 0 ? "+" : "";

  // Each horizon as a bar against the base rate, so "worse than random" is something you see
  // rather than something you have to compute from two numbers.
  const rows = ["t+3h", "t+6h", "t+12h"]
    .map((k) => {
      const h = sc.horizons[k];
      return [
        '            <div class="hbar">',
        `              <span class="h">${k}</span>`,
        '              <span class="track">',
        `                <span class="fill" data-w="${h.followedPct.toFixed(0)}"></span>`,
        "              </span>",
        `              <span class="pc">${h.followedPct.toFixed(0)}%</span>`,
        "            </div>",
      ].join("\n");
    })
    .join("\n");

  const block = [
    "",
    '      <div class="score-nums">',
    `        <div class="sn ev"><span class="v">${h6.followedPct.toFixed(0)}%</span><span class="k">events followed</span></div>`,
    `        <div class="sn base"><span class="v">${sc.baseRateT6Pct.toFixed(0)}%</span><span class="k">any hour</span></div>`,
    `        <div class="sn lift"><span class="v">${sign}${sc.liftT6Points.toFixed(1)}</span><span class="k">lift (points)</span></div>`,
    "      </div>",
    '      <p class="score-verdict">',
    "        Flagged events performed <strong>worse than hours picked at random</strong>.",
    "      </p>",
    '      <div class="hbars">',
    rows,
    "      </div>",
    '      <p class="foot-fine" style="margin:1.2rem auto 0;text-align:center">',
    "        &ldquo;Followed&rdquo; means the lagging series averaged at least 25% above its own",
    `        pre-event baseline afterwards. ${sc.events} events, threshold ${sc.threshold}, ${sc.tokens.length} tokens.`,
    "        Regenerate with <span class=\"m\">npm run scorecard</span>.",
    "      </p>",
    "      ",
  ].join("\n");

  // Re-read: the feed injection above has already written to disk, so the in-memory copy from
  // earlier in this script is stale by the time the scorecard goes in.
  const page = await readFile(HTML, "utf8");
  const a = page.indexOf(SC_START);
  const b = page.indexOf(SC_END);
  if (a !== -1 && b !== -1) {
    await writeFile(HTML, page.slice(0, a + SC_START.length) + block + page.slice(b), "utf8");
    console.log(`Injected scorecard: ${sc.events} events, lift ${sc.liftT6Points} pts.`);
  } else {
    console.warn("Scorecard markers not found in the page.");
  }
}
