/**
 * The divergence event feed - the agent's output, and the artifact a reader actually looks at.
 *
 * Extracted from the runner so the scheduled CI pass can append to it without importing the
 * whole polling path.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FEED_PATH } from "../config.js";
import type { FeedEvent } from "../types.js";

const path = () => fileURLToPath(FEED_PATH);

export async function readFeed(): Promise<FeedEvent[]> {
  try {
    return JSON.parse(await readFile(path(), "utf8")) as FeedEvent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** True if this exact (token, bucket) event was already narrated and recorded. */
export function hasEvent(feed: FeedEvent[], token: string, timestampMs: number): boolean {
  return feed.some((e) => e.token === token && e.timestampMs === timestampMs);
}

/**
 * Appends an event, ignoring one already recorded for the same token and bucket.
 *
 * The dedupe matters because narration costs an API call: without it, every re-run over the same
 * history would re-narrate the same hour and pile duplicates into the feed.
 */
export async function appendToFeed(event: FeedEvent): Promise<boolean> {
  await mkdir(fileURLToPath(new URL(".", FEED_PATH)), { recursive: true });

  const feed = await readFeed();
  if (hasEvent(feed, event.token, event.timestampMs)) return false;

  feed.push(event);
  feed.sort((a, b) => a.timestampMs - b.timestampMs);
  await writeFile(path(), JSON.stringify(feed, null, 2) + "\n", "utf8");
  return true;
}
