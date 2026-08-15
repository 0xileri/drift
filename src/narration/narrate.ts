import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";
import type { DivergenceResult, PollSnapshot, RpcCrossCheck } from "../types.js";

/** Constructed on first use so merely importing this module doesn't require the key. */
let client: Anthropic | null = null;
function anthropicClient(): Anthropic {
  client ??= new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

const SYSTEM_PROMPT = `You are the narration layer for Drift, an agent that tracks when social attention and \
onchain activity for a token disagree. You are given a deterministic divergence score plus the raw \
inputs it was computed from — you did not compute the score yourself and must not second-guess or \
recompute it. Your job is to explain, in plain language, what kind of gap this is (social running ahead \
of onchain activity, or onchain moving while social stays quiet), what that pattern has historically \
tended to precede, and what a reader should watch for next. Ground every claim in the numbers you were \
given. Do not invent data points, prices, or events that aren't in the input. Two to four sentences.

Reading the numbers correctly:
- socialMomentumLogRatio and onchainMomentumLogRatio are NATURAL LOG RATIOS between consecutive \
hourly intervals, not percentages. 0 means flat, +0.69 means the metric doubled, -0.69 means it \
halved. Never describe them as percent change.
- socialZ and onchainZ are robust (median/MAD) z-scores against that token's own recent history, \
capped at +/-10. A capped value means "extreme", not a precise magnitude.
- divergenceScore is socialZ minus onchainZ. Positive means attention is running hotter than \
onchain activity; negative means money is moving while social stays quiet.
- volume24hUsd, liquidityUsd and txns24h are rolling-24h context from a different source than the \
momentum metric. Use them for color, never as evidence of the momentum reading.`;

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
    max_tokens: 300,
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
