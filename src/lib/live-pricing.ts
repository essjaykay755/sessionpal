import type { ModelInfo, ModelMetadata } from "./pricing";

const KEY = "sessionpal.model-prices.v1";
const CATALOG_KEY = "sessionpal.model-catalog.v3";
const PREVIOUS_CATALOG_KEY = "sessionpal.model-catalog.v2";
const MAX_AGE = 24 * 60 * 60 * 1000;
type Entry = { id: string; name?: string; canonical_model_id?: string; cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number } };
type Provider = { name?: string; models?: Record<string, Entry> };

/** Map only unambiguous IDs to canonical model authors, independently of price. */
export function parseModelMetadata(data: unknown): ModelMetadata[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const catalog = data as { providers?: Record<string, Provider>; models?: Record<string, { id?: string; name?: string }> };
  if (!catalog.providers || !catalog.models || typeof catalog.providers !== "object" || typeof catalog.models !== "object") return [];
  const candidates = new Map<string, Set<string>>();
  const canonical = new Map<string, { label: string; family: string }>();
  const add = (alias: string, id: string) => {
    const key = alias.toLowerCase();
    if (!key || key.length > 300) return;
    const ids = candidates.get(key) ?? new Set<string>();
    ids.add(id);
    candidates.set(key, ids);
  };
  for (const [key, model] of Object.entries(catalog.models)) {
    if (!model || typeof model !== "object") continue;
    const id = (typeof model.id === "string" ? model.id : key).toLowerCase();
    const parts = id.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1] || id.length > 300) continue;
    const lab = catalog.providers[parts[0]];
    const family = typeof lab?.name === "string" && lab.name.trim() ? lab.name : parts[0];
    canonical.set(id, { label: typeof model.name === "string" && model.name.trim() ? model.name : parts[1], family });
    add(id, id);
    add(parts[1], id);
  }
  for (const provider of Object.values(catalog.providers)) {
    if (!provider?.models || typeof provider.models !== "object") continue;
    for (const [key, model] of Object.entries(provider.models)) {
      if (!model || typeof model !== "object" || typeof model.canonical_model_id !== "string") continue;
      const id = model.canonical_model_id.toLowerCase();
      if (!canonical.has(id)) continue;
      const alias = typeof model.id === "string" ? model.id : key;
      add(alias, id);
      add(alias.split("/").pop()!, id);
    }
  }
  return Array.from(candidates, ([id, ids]) => {
    if (ids.size !== 1) return null;
    const metadata = canonical.get(ids.values().next().value!)!;
    return { id, ...metadata };
  }).filter((model): model is ModelMetadata => model !== null);
}

/** Prefer the model author's API rate when the catalog identifies the author. */
export function parseLivePrices(data: unknown, canonicalModels?: unknown): ModelInfo[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const providers = data as Record<string, Provider>;
  const canonicalIds = new Set(canonicalModels && typeof canonicalModels === "object" ? Object.keys(canonicalModels) : []);
  const identities = new Map<string, Set<string>>();
  const candidates = new Map<string, Array<{ price: ModelInfo; firstParty: boolean }>>();
  const add = (id: string, model: Entry, firstParty: boolean, displayName?: string) => {
    const cost = model.cost;
    if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number" || cost.input < 0 || cost.output < 0 || cost.input > 1_000_000 || cost.output > 1_000_000 || !Number.isFinite(cost.input) || !Number.isFinite(cost.output) || cost.input + cost.output === 0) return;
    const rate = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : cost.input!;
    const price: ModelInfo = { id, label: displayName || model.name || id, family: "Unknown", color: "#8d8477", input: cost.input, output: cost.output, cacheRead: rate(cost.cache_read), cacheWrite: rate(cost.cache_write) };
    const list = candidates.get(id) ?? [];
    list.push({ price, firstParty });
    candidates.set(id, list);
  };
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider || typeof provider.models !== "object" || !provider.models) continue;
    for (const [key, model] of Object.entries(provider.models)) {
      if (!model || typeof model !== "object") continue;
      const id = (typeof model.id === "string" ? model.id : key).toLowerCase().split("/").pop()!;
      if (!id || id.length > 300) continue;
      const ownId = `${providerId}/${id}`;
      const canonicalId = typeof model.canonical_model_id === "string" ? model.canonical_model_id.toLowerCase()
        : canonicalIds.has(ownId) ? ownId : undefined;
      if (canonicalId) {
        const ids = identities.get(id) ?? new Set<string>();
        ids.add(canonicalId);
        identities.set(id, ids);
      }
      if (id.endsWith("-free") || id.endsWith(":free")) {
        const paidId = id.replace(/(?:-free|:free)$/, "");
        const paid = provider.models[paidId];
        // The provider must publish both IDs; conflicting canonical IDs disqualify the match.
        if (paid && (!model.canonical_model_id || !paid.canonical_model_id || model.canonical_model_id === paid.canonical_model_id)) add(id, paid, false, model.name);
      } else {
        add(id, model, canonicalId?.split("/")[0] === providerId);
      }
    }
  }
  const result: ModelInfo[] = [];
  for (const [id, list] of candidates) {
    if ((identities.get(id)?.size ?? 0) > 1) continue;
    const firstParty = list.filter((candidate) => candidate.firstParty);
    const rates = firstParty.length ? firstParty : list;
    const first = rates[0].price;
    if (rates.every(({ price: p }) => p.input === first.input && p.output === first.output && p.cacheRead === first.cacheRead && p.cacheWrite === first.cacheWrite)) result.push(first);
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadLivePrices(refresh = false): Promise<{ prices: ModelInfo[]; metadata: ModelMetadata[] }> {
  let catalogCache: { time: number; prices: ModelInfo[]; metadata: ModelMetadata[] } | null = null;
  try { catalogCache = JSON.parse(localStorage.getItem(CATALOG_KEY) || "null"); } catch { /* ignore a damaged cache */ }
  let cached: { time: number; prices: ModelInfo[] } | null = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { /* ignore a damaged cache */ }
  if (!refresh && catalogCache && Array.isArray(catalogCache.prices) && Array.isArray(catalogCache.metadata) && Date.now() - catalogCache.time < MAX_AGE) return catalogCache;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://models.dev/catalog.json", { signal: controller.signal, credentials: "omit", cache: "no-cache" });
    if (!response.ok) throw new Error("Pricing catalog unavailable");
    const data = await response.json();
    const prices = parseLivePrices(data.providers, data.models);
    const metadata = parseModelMetadata(data);
    if (!prices.length) throw new Error("Pricing catalog was empty");
    const result = { time: Date.now(), prices, metadata };
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify(result)); } catch { /* retain in memory */ }
    return result;
  } catch {
    if (catalogCache && Array.isArray(catalogCache.prices) && Array.isArray(catalogCache.metadata)) return catalogCache;
    try { catalogCache = JSON.parse(localStorage.getItem(PREVIOUS_CATALOG_KEY) || "null"); } catch { /* ignore a damaged cache */ }
    if (catalogCache && Array.isArray(catalogCache.prices) && Array.isArray(catalogCache.metadata)) return catalogCache;
    return { prices: cached && Array.isArray(cached.prices) ? cached.prices : [], metadata: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export function livePricesUpdatedAt(): string | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CATALOG_KEY) || localStorage.getItem(PREVIOUS_CATALOG_KEY) || localStorage.getItem(KEY) || "null");
    return typeof cached?.time === "number" && Number.isFinite(cached.time) ? new Date(cached.time).toLocaleString() : null;
  } catch { return null; }
}
