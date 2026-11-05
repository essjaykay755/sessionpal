import catalog from "./pricing-catalog.json";
import type { UsageBreakdown } from "./types";

export interface ModelInfo {
  id: string;
  label: string;
  family: "Anthropic" | "OpenAI" | "Google" | "Cursor" | "Moonshot" | "Alibaba" | "Unknown";
  color: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Published API list prices, USD per million tokens, used only for local
 * estimates. The catalog is shared with the Rust backend (`pricing.rs`), so
 * both sides always agree. Update prices there, not here.
 */
export const PRICING_CATALOG = catalog as {
  version: number;
  verifiedAt: string | null;
  models: Array<ModelInfo & { source: string | null }>;
};

export const MODELS: Record<string, ModelInfo> = Object.fromEntries(
  PRICING_CATALOG.models.map((model) => [model.id, model]),
);

export const MODEL_ORDER = Object.keys(MODELS);

export function knownModelInfo(id: string | null | undefined): ModelInfo | null {
  if (!id) return null;
  if (MODELS[id]) return MODELS[id];
  const base = Object.keys(MODELS).find((key) => id.startsWith(`${key}-`) && /^\d{8}$/.test(id.slice(key.length + 1)));
  return base ? MODELS[base] : null;
}

/** `gemini-3.8-flash` → `Gemini 3.8 Flash`, `claude-opus-4-1` → `Claude Opus 4.1`. */
function readableModelName(id: string): string {
  const words: string[] = [];
  for (const part of id.split(/[-_]/).filter(Boolean)) {
    const previous = words[words.length - 1];
    if (/^\d+$/.test(part) && previous && /^\d+$/.test(previous)) {
      words[words.length - 1] = `${previous}.${part}`;
    } else if (/^(gpt|glm|o\d)$/i.test(part)) {
      words.push(part.toUpperCase());
    } else {
      words.push(/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1));
    }
  }
  return words.join(" ");
}

function familyFor(id: string): ModelInfo["family"] {
  if (id.startsWith("claude-")) return "Anthropic";
  if (id.startsWith("gpt-") || /^o\d/.test(id)) return "OpenAI";
  if (id.startsWith("gemini-") || id.startsWith("gemma-")) return "Google";
  return "Unknown";
}

export function modelInfo(id: string | null | undefined): ModelInfo {
  const known = knownModelInfo(id);
  if (known) return known;
  return {
    id: id ?? "unknown",
    label: id ? readableModelName(id) : "Unknown model",
    family: id ? familyFor(id) : "Unknown",
    color: "#8d8477",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

export function estimateUsage(
  model: string,
  parts: { input: number; output: number; cacheRead: number; cacheWrite: number },
): UsageBreakdown {
  const pricing = modelInfo(model);
  if (!knownModelInfo(model)) return { ...parts, cost: null };
  const cost =
    (parts.input * pricing.input +
      parts.output * pricing.output +
      parts.cacheRead * pricing.cacheRead +
      parts.cacheWrite * pricing.cacheWrite) /
    1_000_000;
  return { ...parts, cost: Math.round(cost * 10000) / 10000 };
}

export function usageTokens(usage: UsageBreakdown | null): number {
  if (!usage) return 0;
  // Parsers normalise categories so they never overlap, so every one counts.
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

export function cacheSavings(usage: UsageBreakdown | null, model: string | null): number {
  if (!usage || !model) return 0;
  const pricing = modelInfo(model);
  return (usage.cacheRead * (pricing.input - pricing.cacheRead)) / 1_000_000;
}

export function modelsForAgent(agent: string): Array<{ id: string; weight: number }> {
  switch (agent) {
    case "claude":
      return [
        { id: "claude-sonnet-4-5", weight: 0.62 },
        { id: "claude-opus-4-5", weight: 0.26 },
        { id: "claude-haiku-4-5", weight: 0.12 },
      ];
    case "codex":
      return [
        { id: "gpt-5.1-codex", weight: 0.64 },
        { id: "gpt-5.1-codex-mini", weight: 0.26 },
        { id: "gpt-5.1", weight: 0.1 },
      ];
    case "cursor":
      return [
        { id: "composer-1", weight: 0.55 },
        { id: "claude-4.5-sonnet", weight: 0.3 },
        { id: "gpt-5.1-codex", weight: 0.15 },
      ];
    case "antigravity":
      return [
        { id: "gemini-3.8-flash", weight: 0.58 },
        { id: "claude-opus-4-5", weight: 0.27 },
        { id: "claude-sonnet-4-5", weight: 0.15 },
      ];
    case "opencode":
      return [
        { id: "claude-sonnet-4-5", weight: 0.36 },
        { id: "gpt-5.1-codex-mini", weight: 0.3 },
        { id: "kimi-k2", weight: 0.22 },
        { id: "qwen3-coder", weight: 0.12 },
      ];
    default:
      return [{ id: "claude-sonnet-4-5", weight: 1 }];
  }
}
