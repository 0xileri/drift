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
      <p class="empty">No divergence events recorded yet. The agent polls hourly and posts here
      when a gap crosses the threshold.</p>`;
} else {
  const cards = shown
    .map((e) => {
      const d = e.divergence.divergenceScore ?? 0;
      // Sign carries the meaning: attention ahead of money, or money ahead of attention.
      const dir = d > 0 ? "social ahead" : "onchain ahead";
      const dirClass = d > 0 ? "d-social" : "d-onchain";
      return `
        <article class="ev">
          <header class="ev-h">
            <span class="ev-tok">${esc(e.token)}</span>
            <span class="ev-score ${dirClass}">${d > 0 ? "+" : ""}${d.toFixed(2)}</span>
            <span class="ev-dir">${dir}</span>
            <time class="ev-t" datetime="${new Date(e.timestampMs).toISOString()}">${fmt(e.timestampMs)} UTC</time>
            ${e.backfilled ? '<span class="ev-bf" title="Found by replaying recorded history, not by a live poll at the time">replay</span>' : ""}
          </header>
          <p class="ev-n">${esc(e.narration)}</p>
          <div class="ev-m">
            <span>social rank <b>${(e.divergence.socialRank ?? 0).toFixed(2)}</b></span>
            <span>onchain rank <b>${(e.divergence.onchainRank ?? 0).toFixed(2)}</b></span>
            ${e.rpcCrossCheck ? `<span>pool verified at block <b>${esc(e.rpcCrossCheck.blockNumber)}</b></span>` : ""}
          </div>
        </article>`;
    })
    .join("");

  html = `
      <p class="feed-sum">
        <b>${sorted.length}</b> events across <b>${tokens}</b> tokens${live ? ` · <b>${live}</b> from live polling` : ""}.
        Showing the ${Math.min(SHOW, sorted.length)} most recent.
      </p>
      <div class="feed">${cards}
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
  const rows = ["t+3h", "t+6h", "t+12h"]
    .map((k) => {
      const h = sc.horizons[k];
      return [
        "            <tr>",
        `              <td class="sym">${k}</td>`,
        `              <td class="n">${h.judged}</td>`,
        `              <td class="n">${h.followedPct.toFixed(0)}%</td>`,
        `              <td class="n">${h.noFollowPct.toFixed(0)}%</td>`,
        "            </tr>",
      ].join("\n");
    })
    .join("\n");

  const sign = sc.liftT6Points > 0 ? "+" : "";
  const block = [
    "",
    '      <div class="stats">',
    `        <div class="stat"><span class="v">${h6.followedPct.toFixed(0)}%</span><span class="k">events followed</span></div>`,
    `        <div class="stat"><span class="v">${sc.baseRateT6Pct.toFixed(0)}%</span><span class="k">base rate, any hour</span></div>`,
    `        <div class="stat"><span class="v">${sign}${sc.liftT6Points.toFixed(1)}</span><span class="k">lift (points)</span></div>`,
    `        <div class="stat"><span class="v">${sc.events}</span><span class="k">events tested</span></div>`,
    "      </div>",
    '      <div class="tbl-scroll">',
    "        <table>",
    "          <thead>",
    "            <tr>",
    '              <th scope="col">Horizon</th>',
    '              <th scope="col">Tested</th>',
    '              <th scope="col">Laggard followed</th>',
    '              <th scope="col">Did not</th>',
    "            </tr>",
    "          </thead>",
    "          <tbody>",
    rows,
    "          </tbody>",
    "        </table>",
    "      </div>",
    '      <p class="fine" style="margin-top:0.9rem">',
    "        &ldquo;Followed&rdquo; means the lagging series averaged at least 25% above its own",
    `        pre-event baseline in the hours afterwards. Threshold ${sc.threshold}, ${sc.tokens.length} tokens,`,
    "        replayed from recorded history. Regenerate with <code>npm run scorecard</code>.",
    "      </p>",
    "      ",
  ].join("\n");

  // Re-read: `html` above is the feed fragment, not the page, and the feed injection has
  // already written to disk by this point.
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
