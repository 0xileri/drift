import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";
import type { DivergenceResult, PollSnapshot, RpcCrossCheck } from "../types.js";
import { SYSTEM_PROMPT } from "./prompt.js";

/** Constructed on first use so merely importing this module doesn't require the key. */
let client: Anthropic | null = null;
function anthropicClient(): Anthropic {
  client ??= new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}



export async function narrateDivergence(
  snapshot: PollSnapshot,
  divergence: DivergenceResult,
  rpcCrossCheck: RpcCrossCheck | null
): Promise<string> {
  const payload = {
    token: snapshot.token,
    social: snapshot.social,
    onchain: snapshot.onchain,
    divergence,
    rpcCrossCheck,
  };

  const message = await anthropicClient().messages.create({
    model: "claude-sonnet-5",
    // 48% of the first 92 narrations were cut mid-sentence at 300. The prompt asks for two to
    // four sentences, so this is headroom rather than a licence to ramble.
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Divergence event data:\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}
