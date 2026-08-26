import type { VerifierKind } from "../verify/verifierFor.ts";
import { MODELS } from "./models.ts";

export namespace Variant {
  /**
   * One configuration of the runner under test.
   *
   * Everything an experiment is allowed to change lives here, so any two rows
   * of a result table differ only by the fields printed alongside them.
   */
  export interface Props {
    /** Short stable key; names the result file and the report column. */
    id: string;
    /** One line on what this variant is testing. */
    hypothesis: string;
    /** Provider-prefixed model id, see `config/models.ts`. */
    model: string;
    /**
     * Let the planner split each step into sub-steps. The generated cases are
     * already atomic ("Tap the 'Month' button"), so planning may be a second
     * model call that changes nothing.
     */
    planner: boolean;
    /** Skip the webview context scan when the tree shows no webview. */
    lazyWebviewContexts: boolean;
    /** Ask the model to summarise what changed after each action. */
    changeAnalysis: boolean;
    /** How a step's expected result is confirmed. */
    verifier: VerifierKind;
    /**
     * Model for the verifier, when it should differ from the actor's.
     *
     * Acting and judging are different jobs and the sweep priced them
     * differently: the models that matched on judgement were an order of
     * magnitude apart in cost, while their action quality did not match at all.
     */
    verifierModel?: string | undefined;
    /** How long to let the screen settle before reading it, in milliseconds. */
    treeSettleMs: number;
  }
}

/** The runner exactly as it ships, and the reference every result is read against. */
const BASE = {
  planner: true,
  lazyWebviewContexts: false,
  changeAnalysis: false,
  verifier: "tree",
  treeSettleMs: 0,
} satisfies Omit<Variant.Props, "id" | "hypothesis" | "model">;

/**
 * The cheapest configuration that the speed experiments established: trust the
 * tree about webviews, and skip planning steps that are already atomic. Quality
 * work builds on it so improvements are measured at the price we intend to pay.
 */
const FAST = {
  ...BASE,
  planner: false,
  lazyWebviewContexts: true,
} satisfies typeof BASE;

/**
 * The experiment matrix.
 *
 * Ordered so each variant differs from `baseline` along one axis at a time:
 * first the driver optimisation, then the planner, then the model. That keeps
 * every comparison attributable to a single change.
 */
export const VARIANTS: readonly Variant.Props[] = [
  {
    ...BASE,
    id: "baseline",
    hypothesis: "Runner as shipped: haiku, planner on, full context scans.",
    model: MODELS.haiku,
  },
  {
    ...BASE,
    id: "lazy-webview",
    hypothesis:
      "Skipping the webview scan on native screens cuts wall-clock without touching quality.",
    model: MODELS.haiku,
    lazyWebviewContexts: true,
  },
  {
    ...BASE,
    id: "no-planner",
    hypothesis:
      "Case steps are already atomic, so planning each one is a wasted model call.",
    model: MODELS.haiku,
    lazyWebviewContexts: true,
    planner: false,
  },
  {
    ...FAST,
    id: "settle",
    hypothesis:
      "Reads land mid-animation; letting the screen settle should recover steps lost to a stale tree.",
    model: MODELS.haiku,
    treeSettleMs: 800,
  },
  {
    ...FAST,
    id: "retry",
    hypothesis:
      "A screen that is merely slow reads as absent; one re-check separates 'not there' from 'not there yet'.",
    model: MODELS.haiku,
    treeSettleMs: 800,
    verifier: "tree-retry",
  },
  {
    ...FAST,
    id: "vision",
    hypothesis:
      "Some expectations describe what the screen looks like, which only a screenshot can answer.",
    model: MODELS.haiku,
    treeSettleMs: 800,
    verifier: "tree-retry-vision",
  },
  {
    ...FAST,
    id: "judge",
    hypothesis:
      "The retriever is built to refuse when unsure; a prompt written for judging assertions should stop rejecting screens that plainly satisfy them.",
    model: MODELS.haiku,
    treeSettleMs: 800,
    verifier: "assert-retry",
  },
  {
    ...FAST,
    id: "judge-vision",
    hypothesis:
      "Where the tree cannot answer at all — a state the app draws rather than labels — a screenshot can.",
    model: MODELS.haiku,
    treeSettleMs: 800,
    verifier: "assert-vision",
  },
  {
    ...FAST,
    id: "split-roles",
    hypothesis:
      "Judging is the cheap half: keep the stronger model acting and hand the verdicts to the one that judged as well for a fraction of the price.",
    model: MODELS.haiku,
    treeSettleMs: 800,
    verifier: "assert-retry",
    verifierModel: MODELS.gptOss120b,
  },
  {
    ...FAST,
    id: "gpt-oss-120b",
    hypothesis:
      "An open-weight actor matches haiku's accuracy at a fraction of its latency and price.",
    model: MODELS.gptOss120b,
    treeSettleMs: 800,
    verifier: "assert-retry",
  },
  {
    ...FAST,
    id: "gpt-oss-20b",
    hypothesis: "The smaller sibling is faster still; does accuracy survive?",
    model: MODELS.gptOss20b,
    treeSettleMs: 800,
    verifier: "assert-retry",
  },
  {
    ...FAST,
    id: "qwen3-235b",
    hypothesis: "A large MoE alternative to gpt-oss at a similar price point.",
    model: MODELS.qwen235b,
    treeSettleMs: 800,
    verifier: "assert-retry",
  },
  {
    ...FAST,
    id: "nova-lite",
    hypothesis: "The cheapest Bedrock option; a floor for cost per case.",
    model: MODELS.novaLite,
    treeSettleMs: 800,
    verifier: "assert-retry",
  },
  {
    ...FAST,
    id: "sonnet",
    hypothesis:
      "A frontier model puts a ceiling on what prompt and tooling changes could ever reach.",
    model: MODELS.sonnet,
    treeSettleMs: 800,
    verifier: "assert-retry",
  },
];

export function variantById(id: string): Variant.Props {
  const variant = VARIANTS.find((candidate) => candidate.id === id);
  if (!variant) {
    throw new Error(
      `Unknown variant "${id}". Known: ${VARIANTS.map((v) => v.id).join(", ")}`,
    );
  }
  return variant;
}
