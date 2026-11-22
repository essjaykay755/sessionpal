import catalog from "./pricing-catalog.json";
import type { UsageBreakdown } from "./types";

export interface ModelInfo {
  id: string;
  label: string;
  family: string;
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
let liveModels: Record<string, ModelInfo> = {};
export type ModelMetadata = { id: string; label: string; family: string };
let liveMetadata: Record<string, ModelMetadata> = {};

export function setLiveMetadata(models: ModelMetadata[]): void {
  liveMetadata = Object.fromEntries(models.map((model) => [model.id, model]));
}

export function setLiveModels(models: ModelInfo[]): void {
  liveModels = Object.fromEntries(models.map((model) => [model.id, model]));
}

function findModel(id: string | null | undefined): { model: ModelInfo; source: "models.dev" | "bundled" } | null {
  if (!id) return null;
  if (liveModels[id]) return { model: liveModels[id], source: "models.dev" };
  if (MODELS[id]) return { model: MODELS[id], source: "bundled" };
  const matches = (key: string) => id.startsWith(`${key}-`) && /^\d{8}$/.test(id.slice(key.length + 1));
  const liveBase = Object.keys(liveModels).find(matches);
  if (liveBase) return { model: liveModels[liveBase], source: "models.dev" };
  const bundledBase = Object.keys(MODELS).find(matches);
  return bundledBase ? { model: MODELS[bundledBase], source: "bundled" } : null;
}

export function knownModelInfo(id: string | null | undefined): ModelInfo | null {
  return findModel(id)?.model ?? null;
}

export function modelPriceSource(id: string): "models.dev" | "bundled" | null {
  return findModel(id)?.source ?? null;
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

const GENERIC_MODEL_COLOR = "#8d8477";

const FALLBACK_PALETTE = [
  "#5a7ee6", // cobalt
  "#d46a49", // terracotta
  "#3d9b7b", // emerald
  "#8a6fd6", // iris
  "#cc9235", // amber
  "#389dc4", // cerulean
  "#cf6382", // rose
  "#84a04a", // moss
  "#549ce0", // sky
  "#c26242", // rust
];

function hashModelId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Pick a vivid, family-aligned color when a model has no explicit catalog swatch. */
export function resolveModelColor(id: string | null | undefined, family: string, color?: string): string {
  if (color && color.toLowerCase() !== GENERIC_MODEL_COLOR) return color;
  const key = (id ?? "").toLowerCase();
  const fam = family.toLowerCase();
  if (key.includes("claude") || fam.includes("anthropic")) {
    if (key.includes("opus")) return "#c96642";
    if (key.includes("sonnet")) return "#db8259";
    if (key.includes("haiku")) return "#dfa983";
    return "#cc7250";
  }
  if (key.includes("gemini") || key.includes("gemma") || fam.includes("google")) {
    if (key.includes("flash") || key.includes("lite")) return "#4fa3de";
    if (key.includes("neon")) return "#5a82e6";
    return "#5d7ce2";
  }
  if (
    key.includes("gpt") ||
    key.includes("codex") ||
    /^o[134](?:\b|-)/.test(key) ||
    fam.includes("openai")
  ) {
    if (key.includes("mini") || key.includes("nano") || key.includes("luna")) return "#6fb59d";
    if (key.includes("terra") || key.includes("codex")) return "#48997e";
    return "#3d8772";
  }
  if (key.includes("deepseek") || fam.includes("deepseek")) return "#3c97c2";
  if (key.includes("composer") || fam.includes("cursor")) return "#856dd1";
  if (key.includes("kimi") || fam.includes("moonshot")) return "#c7933a";
  if (key.includes("qwen") || fam.includes("alibaba")) return "#8c9f52";
  if (key.includes("grok") || fam.includes("xai")) return "#c4627f";
  if (key.includes("llama") || fam.includes("meta")) return "#6682cc";
  if (key.includes("mistral") || key.includes("codestral") || fam.includes("mistral")) return "#d48446";
  if (key.includes("glm") || fam.includes("zhipu")) return "#5b9ab0";
  if (!key) return GENERIC_MODEL_COLOR;
  return FALLBACK_PALETTE[hashModelId(key) % FALLBACK_PALETTE.length];
}

export function modelInfo(id: string | null | undefined): ModelInfo {
  const known = knownModelInfo(id);
  const metadata = id ? liveMetadata[id] ?? liveMetadata[id.replace(/-\d{8}$/, "")] : undefined;
  if (known) {
    const family = metadata?.family ?? known.family;
    return {
      ...known,
      family,
      color: resolveModelColor(id, family, known.color),
    };
  }
  const family = metadata?.family ?? "Unknown";
  return {
    id: id ?? "unknown",
    label: metadata?.label ?? (id ? readableModelName(id) : "Unknown model"),
    family,
    color: resolveModelColor(id, family),
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
