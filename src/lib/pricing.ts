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

/** Published API list prices, USD per million tokens. Used only for local estimates. */
// Standard, short-context API rates. Cache writes use the shortest standard TTL.
// https://platform.claude.com/docs/en/about-claude/pricing
// https://developers.openai.com/api/docs/pricing
export const MODELS: Record<string, ModelInfo> = {
  "claude-opus-5-5": { id: "claude-opus-5-5", label: "Claude Opus 5.5", family: "Anthropic", color: "#b9653f", input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", family: "Anthropic", color: "#cd825d", input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "gpt-6.1-sol": { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", family: "OpenAI", color: "#527d6e", input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "gpt-6.1-terra": { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", family: "OpenAI", color: "#668f80", input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
  "gpt-6-luna": { id: "gpt-6-luna", label: "GPT-6 Luna", family: "OpenAI", color: "#87a697", input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "gpt-6-astra": { id: "gpt-6-astra", label: "GPT-6 Astra", family: "OpenAI", color: "#527d6e", input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "gpt-6-sol": { id: "gpt-6-sol", label: "GPT-6 Sol", family: "OpenAI", color: "#668f80", input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-4-5": {
    id: "claude-opus-4-5",
    label: "Claude Opus 4.5",
    family: "Anthropic",
    color: "#b9653f",
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  "claude-sonnet-4-5": {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    family: "Anthropic",
    color: "#cd825d",
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    family: "Anthropic",
    color: "#ddb195",
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
  "gpt-5.1-codex": {
    id: "gpt-5.1-codex",
    label: "GPT-5.1 Codex",
    family: "OpenAI",
    color: "#527d6e",
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 1.25,
  },
  "gpt-5.1-codex-mini": {
    id: "gpt-5.1-codex-mini",
    label: "GPT-5.1 Codex mini",
    family: "OpenAI",
    color: "#87a697",
    input: 0.25,
    output: 2,
    cacheRead: 0.025,
    cacheWrite: 0.25,
  },
  "gpt-5.1": {
    id: "gpt-5.1",
    label: "GPT-5.1",
    family: "OpenAI",
    color: "#8aa0af",
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 1.25,
  },
  "composer-1": {
    id: "composer-1",
    label: "Composer 1",
    family: "Cursor",
    color: "#7668a8",
    input: 0.5,
    output: 2.5,
    cacheRead: 0.05,
    cacheWrite: 0.5,
  },
  "claude-4.5-sonnet": {
    id: "claude-4.5-sonnet",
    // Cursor's own ID for the model; labelled as Cursor shows it so it is not
    // mistaken for a duplicate of claude-sonnet-4-5.
    label: "Claude 4.5 Sonnet",
    family: "Anthropic",
    color: "#c58d74",
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "kimi-k2": {
    id: "kimi-k2",
    label: "Kimi K2",
    family: "Moonshot",
    color: "#9a7e37",
    input: 0.6,
    output: 2.5,
    cacheRead: 0.15,
    cacheWrite: 0.6,
  },
  "qwen3-coder": {
    id: "qwen3-coder",
    label: "Qwen3 Coder",
    family: "Alibaba",
    color: "#a6a27a",
    input: 0.3,
    output: 1.2,
    cacheRead: 0.03,
    cacheWrite: 0.3,
  },
};

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
  return usage.input + usage.output + usage.cacheRead;
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
