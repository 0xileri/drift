/**
 * Exercises the HTTP handlers in-process, without Netlify.
 *
 * The Netlify CLI blocks forever without a TTY, so testing through it is not an option here.
 * Calling the exported handlers directly tests the parts most likely to be wrong anyway -
 * validation, signing, error mapping, rate limiting - and it runs in seconds.
 *
 *   npm run test:fn
 */
import analyze from "../netlify/functions/analyze.mjs";
import narrate from "../netlify/functions/narrate.mjs";

const ctx = (ip = "1.2.3.4") => ({ ip }) as never;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

const get = (symbol: string, ip?: string) =>
  analyze(new Request(`https://x/api/analyze?symbol=${encodeURIComponent(symbol)}`), ctx(ip));

// --- validation -----------------------------------------------------------
for (const [bad, label] of [
  ["", "empty symbol"],
  ["a", "one character"],
  ["WAY-TOO-LONG-TICKER", "too long"],
  ["../etc/passwd", "path traversal"],
  ["<script>", "html injection"],
]) {
  const res = await get(bad);
  const body = (await res.json()) as { code?: string };
  check(`rejects ${label}`, res.status === 400 && body.code === "BAD_SYMBOL", `status ${res.status}`);
}

// --- happy path -----------------------------------------------------------
// Runs BEFORE the unknown-ticker case on purpose. A failed lookup still starts a LunarCrush
// request, and the provider throttle then makes the next call wait 7s - which measures the test
// ordering, not the endpoint. A real request arrives at a fresh instance, so this order matches.
let token = "";
{
  const started = Date.now();
  const res = await get("AERO");
  const elapsed = Date.now() - started;
  const body = (await res.json()) as Record<string, never>;

  check("AERO analyse returns 200", res.status === 200, `status ${res.status}`);
  check("under the 10s function budget", elapsed < 9000, `${elapsed}ms`);
  check("carries a pool address", typeof (body as never as { pool: { address: string } }).pool?.address === "string");
  check("carries a series", Array.isArray((body as never as { series: unknown[] }).series));
  check("sets an edge cache header", /s-maxage/.test(res.headers.get("cache-control") ?? ""));

  token = (body as never as { token: string }).token ?? "";
  check("issues a signed token", token.includes("."));
}

// --- unknown ticker -------------------------------------------------------
{
  const res = await get("ZZZQQQ");
  const body = (await res.json()) as { code?: string };
  check(
    "unknown ticker returns a 4xx, not a crash",
    res.status >= 400 && res.status < 500 && body.code !== "INTERNAL",
    `status ${res.status} code ${body.code}`
  );
}

// --- narration signing ----------------------------------------------------
{
  const res = await narrate(
    new Request("https://x/api/narrate", { method: "POST", body: JSON.stringify({ token: "forged.sig" }) }),
    ctx("5.6.7.8")
  );
  check("rejects a forged token", res.status === 400, `status ${res.status}`);
}
{
  const res = await narrate(
    new Request("https://x/api/narrate", { method: "GET" }),
    ctx("5.6.7.8")
  );
  check("rejects non-POST", res.status === 405, `status ${res.status}`);
}
{
  const started = Date.now();
  const res = await narrate(
    new Request("https://x/api/narrate", { method: "POST", body: JSON.stringify({ token }) }),
    ctx("5.6.7.8")
  );
  const elapsed = Date.now() - started;
  const body = (await res.json()) as { narration?: string };
  check("narrates a valid token", res.status === 200 && (body.narration ?? "").length > 80, `status ${res.status}`);
  check("narration under budget", elapsed < 9000, `${elapsed}ms`);
  if (body.narration) console.log(`\n  "${body.narration.slice(0, 200)}..."\n`);
}

// --- rate limiting --------------------------------------------------------
{
  let limited = false;
  for (let i = 0; i < 15; i++) {
    const res = await analyze(new Request("https://x/api/analyze?symbol=!!"), ctx("9.9.9.9"));
    if (res.status === 429) { limited = true; break; }
  }
  // Invalid symbols short-circuit before the limiter, so this proves ordering too.
  check("invalid input never reaches the rate limiter", !limited);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
