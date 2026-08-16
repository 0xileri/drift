/**
 * Copies the keys the deployed functions need from your local .env into Netlify.
 *
 *   node scripts/set-netlify-env.mjs
 *
 * Exists because Netlify's UI scopes a variable to specific stages, and a variable scoped to
 * "Builds" only is invisible to functions at runtime - which fails exactly like a missing key,
 * with the same error message. This sets scope explicitly so that cannot happen.
 *
 * Reads values from .env on this machine and writes them to your own Netlify site. Values are
 * never printed; only key names and lengths are shown.
 */
import { readFile } from "node:fs/promises";

const SITE_ID = process.argv[2] || process.env.NETLIFY_SITE_ID;
if (!SITE_ID) {
  console.error("Usage: node scripts/set-netlify-env.mjs <site-id>");
  process.exit(1);
}

/** Only what the functions actually read at runtime. NETLIFY_AUTH_TOKEN stays local. */
const NEEDED = ["LUNARCRUSH_API_KEY", "ANTHROPIC_API_KEY"];

const raw = await readFile(".env", "utf8");
const local = new Map();
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && m[2].trim()) local.set(m[1], m[2].trim());
}

const token = local.get("NETLIFY_AUTH_TOKEN") || process.env.NETLIFY_AUTH_TOKEN;
if (!token) {
  console.error("No NETLIFY_AUTH_TOKEN in .env or environment.");
  process.exit(1);
}

const missing = NEEDED.filter((k) => !local.has(k));
if (missing.length) {
  console.error(`Missing from .env: ${missing.join(", ")}`);
  process.exit(1);
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const site = await api(`/sites/${SITE_ID}`);
const account = site.account_id || site.account_slug;
console.log(`Site ${site.name} (account ${account})\n`);

const payload = NEEDED.map((key) => ({
  key,
  // "all" covers builds, functions and runtime. Scoping narrowly is the usual cause of a
  // function reporting a missing key that is plainly set in the dashboard.
  scopes: ["builds", "functions", "runtime", "post_processing"],
  values: [{ context: "all", value: local.get(key) }],
}));

// Create is a bulk POST; a key that already exists must be updated individually instead.
try {
  await api(`/accounts/${account}/env?site_id=${SITE_ID}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
} catch {
  for (const entry of payload) {
    await api(`/accounts/${account}/env/${entry.key}?site_id=${SITE_ID}`, {
      method: "PUT",
      body: JSON.stringify(entry),
    });
  }
}

const after = await api(`/accounts/${account}/env?site_id=${SITE_ID}`);
for (const v of after) {
  const len = (v.values || []).map((x) => (x.value || "").length).join(",");
  console.log(`  ${v.key.padEnd(22)} scopes=${(v.scopes || []).join("|")}  len=${len}`);
}

console.log(
  "\nSet. Functions read these at deploy time, so redeploy for them to take effect:\n" +
    `  node scripts/bundle-functions.mjs && node scripts/deploy-netlify.mjs ${SITE_ID}`
);
