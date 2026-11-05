import { AGENT_ORDER, AGENTS } from "./agents";
import { cacheSavings, knownModelInfo, modelInfo, usageTokens } from "./pricing";
import type {
  AgentId,
  RangeKey,
  SessionSummary,
  UsageBreakdown,
} from "./types";
import { addDays, startOfDay } from "./utils";

export const RANGE_DAYS: Record<RangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

export const RANGE_LABELS: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "1y": "Last 12 months",
};

export const RANGE_SHORT: Record<RangeKey, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "3M",
  "1y": "1Y",
};

export function inRange(session: SessionSummary, days: number, now = Date.now()): boolean {
  return now - new Date(session.updatedAt).getTime() <= days * 86_400_000;
}

export function filterRange(
  sessions: SessionSummary[],
  range: RangeKey,
  now = Date.now(),
): SessionSummary[] {
  const days = RANGE_DAYS[range];
  return sessions.filter((session) => inRange(session, days, now));
}

// A session-level model cannot price a mixed-model transcript reliably.
export function canEstimateSessionCost(session: SessionSummary): boolean {
  return !!session.usage && session.usage.cost !== null && new Set(session.models.filter(Boolean)).size <= 1;
}

function canEstimateCacheSavings(session: SessionSummary): boolean {
  return !!session.usage && !!knownModelInfo(session.model) && new Set(session.models.filter(Boolean)).size <= 1;
}

export interface DayPoint {
  key: string;
  date: Date;
  input: number;
  output: number;
  cacheRead: number;
  tokens: number;
  cost: number;
  sessions: number;
}

export function dailyUsage(
  sessions: SessionSummary[],
  range: RangeKey,
  now = Date.now(),
): DayPoint[] {
  const days = RANGE_DAYS[range];
  const end = startOfDay(now);
  const start = addDays(end, -(days - 1));
  const points = new Map<string, DayPoint>();
  for (let index = 0; index < days; index += 1) {
    const date = addDays(start, index);
    const key = dateKey(date);
    points.set(key, {
      key,
      date,
      input: 0,
      output: 0,
      cacheRead: 0,
      tokens: 0,
      cost: 0,
      sessions: 0,
    });
  }
  for (const session of sessions) {
    const stamp = new Date(session.updatedAt);
    if (stamp.getTime() < start.getTime() || stamp.getTime() > now) continue;
    const key = dateKey(stamp);
    const point = points.get(key);
    if (!point) continue;
    point.sessions += 1;
    if (session.usage) {
      point.input += session.usage.input;
      point.output += session.usage.output;
      point.cacheRead += session.usage.cacheRead;
      if (canEstimateSessionCost(session)) point.cost += session.usage.cost ?? 0;
      point.tokens += usageTokens(session.usage);
    }
  }
  return Array.from(points.values());
}

export function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function cumulativeSessionSeries(
  sessions: SessionSummary[],
  range: RangeKey,
  now = Date.now(),
): Array<{ date: Date; value: number; key: string }> {
  const days = RANGE_DAYS[range];
  const end = startOfDay(now);
  const start = addDays(end, -(days - 1));
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
  );
  let running = sorted.filter((session) => new Date(session.updatedAt) < start).length;
  const bucket = new Map<string, number>();
  for (const session of sorted) {
    const stamp = new Date(session.updatedAt);
    if (stamp.getTime() < start.getTime()) continue;
    if (stamp.getTime() > now) continue;
    const key = dateKey(stamp);
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  const points: Array<{ date: Date; value: number; key: string }> = [];
  for (let index = 0; index < days; index += 1) {
    const date = addDays(start, index);
    const key = dateKey(date);
    running += bucket.get(key) ?? 0;
    points.push({ date, value: running, key });
  }
  return points;
}

export function additionsInRange(
  sessions: SessionSummary[],
  range: RangeKey,
  now = Date.now(),
): number {
  return filterRange(sessions, range, now).length;
}

export interface AgentStat {
  id: AgentId;
  name: string;
  sessions: number;
  tokens: number;
  cost: number;
  storage: number;
  share: number;
  lastActive: string | null;
  available: boolean;
}

export function agentStats(sessions: SessionSummary[]): AgentStat[] {
  const total = sessions.length || 1;
  return AGENT_ORDER.map((id) => {
    const agentSessions = sessions.filter((session) => session.agent === id);
    const last = agentSessions.reduce<string | null>((latest, session) => {
      if (!latest) return session.updatedAt;
      return new Date(session.updatedAt) > new Date(latest) ? session.updatedAt : latest;
    }, null);
    return {
      id,
      name: AGENTS[id].name,
      sessions: agentSessions.length,
      tokens: agentSessions.reduce((sum, session) => sum + session.tokens, 0),
      cost: agentSessions.reduce((sum, session) => sum + (session.usage?.cost ?? 0), 0),
      storage: agentSessions.reduce((sum, session) => sum + session.sizeBytes, 0),
      share: (agentSessions.length / total) * 100,
      lastActive: last,
      available: agentSessions.length > 0,
    };
  });
}

export interface ModelStat {
  id: string;
  label: string;
  color: string;
  family: string;
  tokens: number;
  cost: number;
  costKnown: boolean;
  sessions: number;
  share: number;
}

export function modelStats(sessions: SessionSummary[]): ModelStat[] {
  const map = new Map<string, ModelStat>();
  let totalTokens = 0;
  for (const session of sessions) {
    if (!session.usage || !session.model) continue;
    const tokens = usageTokens(session.usage);
    const cost = canEstimateSessionCost(session) ? session.usage.cost ?? 0 : 0;
    totalTokens += tokens;
    const mixed = new Set(session.models.filter(Boolean)).size > 1;
    const modelId = mixed ? "__multiple_models__" : session.model;
    const current = map.get(modelId);
    if (current) {
      current.tokens += tokens;
      current.cost += cost;
      current.costKnown &&= canEstimateSessionCost(session);
      current.sessions += 1;
    } else {
      const info = modelInfo(session.model);
      map.set(modelId, {
        id: modelId,
        label: mixed ? "Multiple models" : info.label,
        color: info.color,
        family: mixed ? "Mixed session" : info.family,
        tokens,
        cost,
        costKnown: canEstimateSessionCost(session),
        sessions: 1,
        share: 0,
      });
    }
  }
  const stats = Array.from(map.values()).sort((a, b) => b.tokens - a.tokens);
  for (const stat of stats) {
    stat.share = totalTokens ? (stat.tokens / totalTokens) * 100 : 0;
  }
  return stats;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  cacheSavings: number;
  sessions: number;
  sessionsWithUsage: number;
  pricedSessions: number;
  savingsSessions: number;
}

export function usageTotals(sessions: SessionSummary[]): UsageTotals {
  return sessions.reduce<UsageTotals>(
    (totals, session) => {
      totals.sessions += 1;
      if (!session.usage) return totals;
      totals.sessionsWithUsage += 1;
      totals.input += session.usage.input;
      totals.output += session.usage.output;
      totals.cacheRead += session.usage.cacheRead;
      totals.cacheWrite += session.usage.cacheWrite;
      totals.tokens += usageTokens(session.usage);
      if (canEstimateSessionCost(session)) {
        totals.cost += session.usage.cost ?? 0;
        totals.pricedSessions += 1;
      }
      if (canEstimateCacheSavings(session)) {
        totals.cacheSavings += cacheSavings(session.usage, session.model);
        totals.savingsSessions += 1;
      }
      return totals;
    },
    {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 0,
      cost: 0,
      cacheSavings: 0,
      sessions: 0,
      sessionsWithUsage: 0,
      pricedSessions: 0,
      savingsSessions: 0,
    },
  );
}

export function usageWithTotals(usage: UsageBreakdown | null): number {
  return usage ? usageTokens(usage) : 0;
}

export function sessionUsageParts(sessions: SessionSummary[]): Array<{
  label: string;
  value: number;
  color: string;
}> {
  const totals = usageTotals(sessions);
  return [
    { label: "Input", value: totals.input, color: "#708d92" },
    { label: "Output", value: totals.output, color: "#b8693f" },
    { label: "Cache read", value: totals.cacheRead, color: "#88956b" },
  ];
}

export function projectStats(sessions: SessionSummary[]): Array<{
  slug: string;
  label: string;
  sessions: number;
  storage: number;
  tokens: number;
}> {
  const map = new Map<string, { slug: string; label: string; sessions: number; storage: number; tokens: number }>();
  for (const session of sessions) {
    const current = map.get(session.project);
    if (current) {
      current.sessions += 1;
      current.storage += session.sizeBytes;
      current.tokens += session.tokens;
    } else {
      map.set(session.project, {
        slug: session.project,
        label: session.projectLabel,
        sessions: 1,
        storage: session.sizeBytes,
        tokens: session.tokens,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.sessions - a.sessions);
}
