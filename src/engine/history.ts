import { mkdir, appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HISTORY_DIR } from "../config.js";
import type { PollSnapshot } from "../types.js";

function historyFilePath(token: string): string {
  return fileURLToPath(new URL(`${token}.jsonl`, HISTORY_DIR));
}

export async function appendSnapshot(snapshot: PollSnapshot): Promise<void> {
  await mkdir(fileURLToPath(HISTORY_DIR), { recursive: true });
  await appendFile(historyFilePath(snapshot.token), JSON.stringify(snapshot) + "\n", "utf8");
}

/** Returns snapshots oldest-first. Missing file (first ever poll for a token) returns []. */
export async function readHistory(token: string): Promise<PollSnapshot[]> {
  try {
    const raw = await readFile(historyFilePath(token), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as PollSnapshot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
