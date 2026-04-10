import type { Usage } from "@claude-lens/parser";

type ModelPricing = {
  input: number;    // $ per 1M tokens
  output: number;   // $ per 1M tokens
  cacheRead: number;
  cacheWrite: number;
};

// Prefix → pricing. Checked in order; first match wins.
const PRICING: [prefix: string, pricing: ModelPricing][] = [
  ["claude-opus-4", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ["claude-sonnet-4", { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["claude-haiku-4", { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }],
  ["claude-3-5-sonnet", { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["claude-3-5-haiku", { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }],
  ["claude-3-opus", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
];

function findPricing(model: string): ModelPricing | null {
  for (const [prefix, pricing] of PRICING) {
    if (model.startsWith(prefix)) return pricing;
  }
  return null;
}

/**
 * Estimate cost in USD for a given model + usage.
 * Returns null if model is unrecognized.
 */
export function estimateCost(model: string, usage: Usage): number | null {
  const p = findPricing(model);
  if (!p) return null;

  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheRead * p.cacheRead +
      usage.cacheWrite * p.cacheWrite) /
    1_000_000
  );
}
