/**
 * Deploys site/ to Netlify through the REST API.
 *
 * The official CLI is avoided deliberately: it spawns an interactive flow that blocks forever
 * when stdin is not a TTY, even with NETLIFY_AUTH_TOKEN already set. The digest API below is
 * fully non-interactive, so this works from CI or any automated shell.
 *
 * Protocol: declare a path -> sha1 digest, and Netlify replies with only the hashes it does not
 * already have. Unchanged files are never re-uploaded.
 *
 *   node scripts/deploy-netlify.mjs <site_id>
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const SITE_ID = process.argv[2];
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const DIR = "site";

if (!SITE_ID) throw new Error("Usage: node scripts/deploy-netlify.mjs <site_id>");
if (!TOKEN) throw new Error("NETLIFY_AUTH_TOKEN is not set");

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const paths = await walk(DIR);
const files = new Map();

for (const p of paths) {
  const buf = await readFile(p);
  // Netlify keys files by web path with a leading slash, so normalise Windows separators.
  const web = "/" + relative(DIR, p).split(sep).join("/");
  files.set(web, { sha: createHash("sha1").update(buf).digest("hex"), buf });
}

console.log(`Deploying ${files.size} file(s) from ${DIR}/`);
for (const [web, f] of files) console.log(`  ${web}  ${f.buf.length} bytes`);

const digest = Object.fromEntries([...files].map(([web, f]) => [web, f.sha]));

const deploy = await api(`/sites/${SITE_ID}/deploys`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ files: digest, draft: false }),
});

console.log(`\nDeploy ${deploy.id} created; ${deploy.required.length} file(s) need upload.`);

for (const sha of deploy.required) {
  const entry = [...files].find(([, f]) => f.sha === sha);
  if (!entry) continue;
  const [web, f] = entry;
  console.log(`  uploading ${web}`);
  await api(`/deploys/${deploy.id}/files${web}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: f.buf,
  });
}

// Poll until the deploy leaves its transient states, so a "done" here means actually serving.
let state = deploy.state;
for (let i = 0; i < 30 && !["ready", "error"].includes(state); i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const d = await api(`/deploys/${deploy.id}`);
  state = d.state;
}

console.log(`\nstate: ${state}`);
if (state === "error") process.exit(1);

const site = await api(`/sites/${SITE_ID}`);
console.log(`live:  ${site.ssl_url ?? site.url}`);
