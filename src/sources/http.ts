/**
 * Shared network-fault handling for the data source clients.
 *
 * Extracted because both clients need identical retry semantics, and a second copy of this logic
 * drifts the moment one of them learns about a new failure mode.
 */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Named codes worth retrying. Not exhaustive on purpose - see isTransient, which also treats the
 * whole TLS-error family as transient rather than enumerating it.
 */
const TRANSIENT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
]);

/**
 * Whether a thrown fetch error is worth retrying.
 *
 * TLS faults are matched by FAMILY, not by code. Enumerating them individually failed three
 * times in a row against the same endpoint - each retry surfaced a different code
 * (ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC, then ERR_SSL_SSL/TLS_ALERT_ILLEGAL_PARAMETER),
 * because a flaky connection can break at any point in the handshake or record layer. All of
 * them are intermittent and all succeed on a later attempt, so the family is the right unit.
 *
 * The code may sit on the error or on `cause` depending on which layer raised it; check both.
 */
export function isTransient(err: unknown): boolean {
  const e = err as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string; library?: string };
  };

  if (e?.code && TRANSIENT_CODES.has(e.code)) return true;
  if (e?.cause?.code && TRANSIENT_CODES.has(e.cause.code)) return true;

  // Any TLS-layer failure, however it happens to be spelled.
  if (e?.cause?.library === "SSL routines") return true;
  if (e?.code?.startsWith("ERR_SSL_") || e?.cause?.code?.startsWith("ERR_SSL_")) return true;

  const text = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  return /ssl|tls|socket hang up|other side closed|bad record mac|decryption failed/i.test(text);
}

/**
 * Serialises calls through a shared queue with a minimum gap between them.
 *
 * Necessary because the runner polls tokens concurrently: without this, five parallel token
 * polls fire five simultaneous requests at the same host, which reads as a burst and draws 429s
 * even when the sustained rate is well inside the limit. Retry alone recovers but turns one
 * cycle into minutes of backoff.
 */
export function createThrottle(minIntervalMs: number) {
  let lastAt = 0;
  let queue: Promise<unknown> = Promise.resolve();

  return function throttle<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const since = Date.now() - lastAt;
      if (since < minIntervalMs) await sleep(minIntervalMs - since);
      lastAt = Date.now();
      return fn();
    };

    const result = queue.then(run, run);
    // Keep the chain alive on failure so one error can't wedge every later caller.
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

export interface RetryOptions {
  attempts?: number;
  /** Base delay; grows linearly with attempt number. */
  backoffMs?: number;
  init?: RequestInit;
  /** Called before each wait, for progress output. */
  onRetry?: (attempt: number, waitMs: number, reason: string) => void;
}

/**
 * Fetch with retry on transient network faults and on 429/5xx responses.
 * Non-transient errors and 4xx responses (other than 429) are returned or thrown immediately -
 * retrying a 401 or a 404 just wastes time and rate limit.
 */
export async function fetchWithRetry(url: string | URL, opts: RetryOptions = {}): Promise<Response> {
  const { attempts = 4, backoffMs = 5000, init, onRetry } = opts;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, init);

      if ((res.status === 429 || res.status >= 500) && attempt < attempts - 1) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const wait = Math.max(retryAfter * 1000, backoffMs * (attempt + 1));
        onRetry?.(attempt + 1, wait, `HTTP ${res.status}`);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      if (!isTransient(err) || attempt === attempts - 1) throw err;
      const wait = backoffMs * (attempt + 1);
      const reason =
        (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error).message.slice(0, 40);
      onRetry?.(attempt + 1, wait, reason);
      await sleep(wait);
    }
  }
  throw new Error("unreachable");
}
