/**
 * Bundles each Netlify function into a self-contained zip the deploy API can upload.
 *
 * Needed because the file-digest deploy path uploads static assets only - functions travel as
 * separate zipped bundles with their own sha256 digests. Everything is inlined by esbuild so the
 * bundle carries no node_modules and nothing has to be installed at runtime.
 *
 *   node scripts/bundle-functions.mjs   ->  .netlify-build/<name>.zip
 */
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SRC = "netlify/functions";
const OUT = ".netlify-build";

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Leading underscore marks a shared module, not an endpoint - bundling it would publish a
// function that has no handler.
const entries = (await readdir(SRC)).filter(
  (f) => /\.(mts|ts|mjs|js)$/.test(f) && !f.startsWith("_")
);
const manifest = {};

for (const file of entries) {
  const name = file.replace(/\.(mts|ts|mjs|js)$/, "");
  const jsPath = join(OUT, `${name}.mjs`);

  await build({
    entryPoints: [join(SRC, file)],
    outfile: jsPath,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    // The AWS SDK-style externals Netlify provides at runtime; bundling them bloats the zip.
    external: ["@netlify/functions"],
    // Baked in rather than set as a Netlify env var: this is a property of running inside a
    // 10s function, not a deployment preference, and it must not depend on remembering to
    // configure it.
    define: { "process.env.HTTP_FAST_FAIL": '"1"' },
    minify: true,
    logLevel: "error",
    // CommonJS dependencies in the graph (dotenv reaches for `fs`) compile to a __require shim
    // that throws in an ESM output. Restoring a real `require` lets those calls resolve instead
    // of failing at import time with "Dynamic require of fs is not supported".
    banner: {
      js: "import{createRequire as __nfCreateRequire}from'module';const require=__nfCreateRequire(import.meta.url);",
    },
  });

  const code = await readFile(jsPath);

  const zip = new AdmZip();
  // Netlify resolves the handler from package.json "main" inside the bundle.
  zip.addFile(`${name}.mjs`, code);
  zip.addFile(
    "package.json",
    Buffer.from(JSON.stringify({ name, version: "1.0.0", type: "module", main: `${name}.mjs` }))
  );

  const buf = zip.toBuffer();
  const zipPath = join(OUT, `${name}.zip`);
  await writeFile(zipPath, buf);

  manifest[name] = {
    path: zipPath,
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };

  console.log(`${name.padEnd(10)} ${(buf.length / 1024).toFixed(0)}KB  ${manifest[name].sha256.slice(0, 12)}…`);
}

await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\n${Object.keys(manifest).length} function(s) bundled to ${OUT}/`);
