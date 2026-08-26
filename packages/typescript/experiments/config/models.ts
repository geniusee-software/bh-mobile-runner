/**
 * Bedrock model ids as this account must address them from eu-central-1.
 *
 * Anthropic and Nova are only reachable through a regional inference profile —
 * the bare model id is rejected for on-demand throughput — while the
 * open-weight models are invoked directly. The `eu.` profiles are preferred
 * over `global.` so a run cannot silently route to another region's capacity
 * and skew the latency numbers.
 */
export const MODELS = {
  haiku: "aws_anthropic/eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  sonnet: "aws_anthropic/eu.anthropic.claude-sonnet-4-6",
  gptOss120b: "aws_openai/openai.gpt-oss-120b-1:0",
  gptOss20b: "aws_openai/openai.gpt-oss-20b-1:0",
  qwen235b: "aws_qwen/qwen.qwen3-235b-a22b-2507-v1:0",
  qwen32b: "aws_qwen/qwen.qwen3-32b-v1:0",
  novaLite: "aws_amazon/eu.amazon.nova-2-lite-v1:0",
} as const;

export const CANDIDATE_MODELS: readonly string[] = Object.values(MODELS);

/**
 * Published Bedrock on-demand rates, USD per million tokens. Keyed by a
 * substring of the model id so the same entry serves the bare id and every
 * regional profile that wraps it.
 */
const RATES: ReadonlyArray<[string, { input: number; output: number }]> = [
  ["claude-haiku-4-5", { input: 1.0, output: 5.0 }],
  ["claude-sonnet-4-6", { input: 3.0, output: 15.0 }],
  ["claude-sonnet-5", { input: 3.0, output: 15.0 }],
  ["gpt-oss-120b", { input: 0.15, output: 0.6 }],
  ["gpt-oss-20b", { input: 0.07, output: 0.3 }],
  ["qwen3-235b", { input: 0.22, output: 0.88 }],
  ["qwen3-32b", { input: 0.15, output: 0.6 }],
  ["nova-2-lite", { input: 0.06, output: 0.24 }],
];

export interface ModelRate {
  input: number;
  output: number;
}

/**
 * Rate card for a model, or NaN rates when the model is unpriced — an unknown
 * model must report as unpriced rather than as free.
 */
export function rateFor(modelName: string): ModelRate {
  const match = RATES.find(([fragment]) => modelName.includes(fragment));
  return match ? match[1] : { input: Number.NaN, output: Number.NaN };
}
