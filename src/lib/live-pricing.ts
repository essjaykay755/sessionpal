import type { ModelInfo } from "./pricing";

const KEY = "sessionpal.model-prices.v1";
const MAX_AGE = 24 * 60 * 60 * 1000;
type Entry = { id: string; name?: string; canonical_model_id?: string; cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number } };
type Provider = { models?: Record<string, Entry> };

/** Build a conservative ID map. Ambiguous IDs are omitted instead of guessed. */
export function parseLivePrices(data: unknown): ModelInfo[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const providers = data as Record<string, Provider>;
  const candidates = new Map<string, ModelInfo[]>();
  const add = (id: string, model: Entry, displayName?: string) => {
    const cost = model.cost;
    if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number" || cost.input < 0 || cost.output < 0 || cost.input > 1_000_000 || cost.output > 1_000_000 || !Number.isFinite(cost.input) || !Number.isFinite(cost.output) || cost.input + cost.output === 0) return;
    const rate = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : cost.input!;
    const price: ModelInfo = { id, label: displayName || model.name || id, family: "Unknown", color: "#8d8477", input: cost.input, output: cost.output, cacheRead: rate(cost.cache_read), cacheWrite: rate(cost.cache_write) };
    const list = candidates.get(id) ?? [];
    list.push(price);
    candidates.set(id, list);
  };
  for (const provider of Object.values(providers)) {
    if (!provider || typeof provider.models !== "object" || !provider.models) continue;
    for (const [key, model] of Object.entries(provider.models)) {
      if (!model || typeof model !== "object") continue;
      const id = (typeof model.id === "string" ? model.id : key).toLowerCase().split("/").pop()!;
      if (!id || id.length > 300) continue;
      if (id.endsWith("-free") || id.endsWith(":free")) {
        const paidId = id.replace(/(?:-free|:free)$/, "");
        const paid = provider.models[paidId];
        // The provider must publish both IDs; conflicting canonical IDs disqualify the match.
        if (paid && (!model.canonical_model_id || !paid.canonical_model_id || model.canonical_model_id === paid.canonical_model_id)) add(id, paid, model.name);
      } else {
        add(id, model);
      }
    }
  }
  const result: ModelInfo[] = [];
  for (const list of candidates.values()) {
    const first = list[0];
    if (list.every((p) => p.input === first.input && p.output === first.output && p.cacheRead === first.cacheRead && p.cacheWrite === first.cacheWrite)) result.push(first);
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadLivePrices(): Promise<ModelInfo[]> {
  let cached: { time: number; prices: ModelInfo[] } | null = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { /* ignore a damaged cache */ }
  if (cached && Array.isArray(cached.prices) && Date.now() - cached.time < MAX_AGE) return cached.prices;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://models.dev/api.json", { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error("Pricing catalog unavailable");
    const prices = parseLivePrices(await response.json());
    if (!prices.length) throw new Error("Pricing catalog was empty");
    try { localStorage.setItem(KEY, JSON.stringify({ time: Date.now(), prices })); } catch { /* retain in memory */ }
    return prices;
  } catch {
    return cached && Array.isArray(cached.prices) ? cached.prices : [];
  } finally {
    clearTimeout(timeout);
  }
}

export function livePricesUpdatedAt(): string | null {
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || "null");
    return typeof cached?.time === "number" && Number.isFinite(cached.time) ? new Date(cached.time).toLocaleString() : null;
  } catch { return null; }
}
