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

/** An inclusive span of local calendar days, as `YYYY-MM-DD` keys. */
export interface DayWindow {
  from: string;
  to: string;
}

/**
 * The calendar days a range covers. `periodsBack` shifts it into the past, so
 * `1` is the equally long period immediately before.
 */
export function rangeWindow(range: RangeKey, now = Date.now(), periodsBack = 0): DayWindow {
  const days = RANGE_DAYS[range];
  const end = addDays(startOfDay(now), -days * periodsBack);
  return { from: dateKey(addDays(end, -(days - 1))), to: dateKey(end) };
}

/** True when a session was active at some point during the window. */
export function overlapsWindow(session: SessionSummary, window: DayWindow): boolean {
  const created = dateKey(new Date(session.createdAt));
  const updated = dateKey(new Date(session.updatedAt));
  return created <= window.to && updated >= window.from;
}

/** True when the session's usage can be placed on the days it happened. */
export function hasDatedUsage(session: SessionSummary): boolean {
  return !!session.usageDays && session.usageDays.length > 0;
}

/**
 * The part of a session's usage that happened inside the window. Sessions
 * without per-day data are attributed whole to their last-updated day.
 */
export function usageInWindow(
  session: SessionSummary,
  window?: DayWindow,
): UsageBreakdown | null {
  if (!session.usage) return null;
  if (!window) return session.usage;
  if (!hasDatedUsage(session)) {
    const updated = dateKey(new Date(session.updatedAt));
    return updated >= window.from && updated <= window.to ? session.usage : null;
  }
  const result: UsageBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let found = false;
  for (const day of session.usageDays ?? []) {
    if (day.day < window.from || day.day > window.to) continue;
    found = true;
    result.input += day.input;
    result.output += day.output;
    result.cacheRead += day.cacheRead;
    result.cacheWrite += day.cacheWrite;
    result.cost = result.cost === null || day.cost === null ? null : result.cost + day.cost;
  }
  if (!found) return null;
  // A session-level cost of null means part of it was unpriced.
  if (session.usage.cost === null) result.cost = null;
  return result;
}

export interface DayPoint {
  key: string;
  date: Date;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
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
      cacheWrite: 0,
      tokens: 0,
      cost: 0,
      sessions: 0,
    });
  }
  const add = (point: DayPoint, usage: UsageBreakdown, priced: boolean) => {
    point.input += usage.input;
    point.output += usage.output;
    point.cacheRead += usage.cacheRead;
    point.cacheWrite += usage.cacheWrite;
    point.tokens += usageTokens(usage);
    if (priced) point.cost += usage.cost ?? 0;
  };
  for (const session of sessions) {
    const priced = canEstimateSessionCost(session);
    if (hasDatedUsage(session)) {
      // Place each day's tokens on the day they were spent.
      for (const day of session.usageDays ?? []) {
        const point = points.get(day.day);
        if (!point) continue;
        point.sessions += 1;
        add(point, day, priced);
      }
      continue;
    }
    // No per-message timestamps: fall back to the last-updated day.
    const stamp = new Date(session.updatedAt);
    if (stamp.getTime() < start.getTime() || stamp.getTime() > now) continue;
    const point = points.get(dateKey(stamp));
    if (!point) continue;
    point.sessions += 1;
    if (session.usage) add(point, session.usage, priced);
  }
  return Array.from(points.values());
}

/** How many sessions with usage can only be dated by their last update. */
export function undatedUsageSessions(sessions: SessionSummary[]): number {
  return sessions.filter((session) => session.usage && !hasDatedUsage(session)).length;
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
  // A library grows when sessions are created, not when they are touched.
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  let running = sorted.filter((session) => new Date(session.createdAt) < start).length;
  const bucket = new Map<string, number>();
  for (const session of sorted) {
    const stamp = new Date(session.createdAt);
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

/** Sessions created (not merely updated) within the range. */
export function additionsInRange(
  sessions: SessionSummary[],
  range: RangeKey,
  now = Date.now(),
): number {
  const days = RANGE_DAYS[range];
  return sessions.filter((session) => {
    const created = new Date(session.createdAt).getTime();
    return created <= now && now - created <= days * 86_400_000;
  }).length;
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

export function agentStats(sessions: SessionSummary[], window?: DayWindow): AgentStat[] {
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
      tokens: agentSessions.reduce(
        (sum, session) => sum + (window ? usageTokens(usageInWindow(session, window)) : session.tokens),
        0,
      ),
      cost: agentSessions.reduce((sum, session) => sum + (usageInWindow(session, window)?.cost ?? 0), 0),
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

export function modelStats(sessions: SessionSummary[], window?: DayWindow): ModelStat[] {
  const map = new Map<string, ModelStat>();
  let totalTokens = 0;
  for (const session of sessions) {
    const usage = usageInWindow(session, window);
    if (!usage || !session.model) continue;
    const tokens = usageTokens(usage);
    const cost = canEstimateSessionCost(session) ? usage.cost ?? 0 : 0;
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

/**
 * Totals across sessions. With a window, only usage that happened inside it is
 * counted, so a long session is split across the periods it spans.
 */
export function usageTotals(sessions: SessionSummary[], window?: DayWindow): UsageTotals {
  return sessions.reduce<UsageTotals>(
    (totals, session) => {
      totals.sessions += 1;
      const usage = usageInWindow(session, window);
      if (!usage) return totals;
      totals.sessionsWithUsage += 1;
      totals.input += usage.input;
      totals.output += usage.output;
      totals.cacheRead += usage.cacheRead;
      totals.cacheWrite += usage.cacheWrite;
      totals.tokens += usageTokens(usage);
      if (canEstimateSessionCost(session)) {
        totals.cost += usage.cost ?? 0;
        totals.pricedSessions += 1;
      }
      if (canEstimateCacheSavings(session)) {
        totals.cacheSavings += cacheSavings(usage, session.model);
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

export function sessionUsageParts(sessions: SessionSummary[], window?: DayWindow): Array<{
  label: string;
  value: number;
  color: string;
}> {
  const totals = usageTotals(sessions, window);
  return [
    { label: "Input", value: totals.input, color: "#708d92" },
    { label: "Output", value: totals.output, color: "#b8693f" },
    { label: "Cache read", value: totals.cacheRead, color: "#88956b" },
    { label: "Cache write", value: totals.cacheWrite, color: "#a58a5f" },
  ];
}

/** Sessions in the same repository share a key, whatever folder they ran in. */
export function projectKey(session: SessionSummary): string {
  return session.projectRoot ? `root:${session.projectRoot}` : `slug:${session.project}`;
}

export function projectName(session: SessionSummary): string {
  return session.projectRootLabel || session.projectLabel;
}

export interface ProjectCostStat {
  key: string;
  label: string;
  /** Display path of the repository, or empty when unknown. */
  path: string;
  tint: SessionSummary["tint"];
  icon: string;
  sessions: number;
  sessionsWithUsage: number;
  pricedSessions: number;
  tokens: number;
  cost: number;
  /** False when some of the project's usage could not be priced. */
  costComplete: boolean;
  cacheSavings: number;
  agents: AgentId[];
  models: string[];
  lastActive: string;
  /** Share of all tokens in the set. */
  tokenShare: number;
  /** Share of all estimated cost in the set. */
  costShare: number;
  members: SessionSummary[];
}

/**
 * Usage and estimated cost per project. With a window, only usage inside it
 * counts, so totals match the page-level figures for the same period.
 */
export function projectCostStats(sessions: SessionSummary[], window?: DayWindow): ProjectCostStat[] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const key = projectKey(session);
    const group = groups.get(key);
    if (group) group.push(session);
    else groups.set(key, [session]);
  }
  const stats: ProjectCostStat[] = [];
  for (const [key, members] of groups) {
    const totals = usageTotals(members, window);
    const first = members[0];
    const agents = AGENT_ORDER.filter((agent) => members.some((session) => session.agent === agent));
    const modelTokens = new Map<string, number>();
    for (const session of members) {
      if (!session.model) continue;
      const label = new Set(session.models.filter(Boolean)).size > 1 ? "Multiple models" : modelInfo(session.model).label;
      modelTokens.set(label, (modelTokens.get(label) ?? 0) + usageTokens(usageInWindow(session, window)));
    }
    stats.push({
      key,
      label: projectName(first),
      path: first.projectRoot ?? "",
      tint: first.tint,
      icon: first.icon,
      sessions: totals.sessions,
      sessionsWithUsage: totals.sessionsWithUsage,
      pricedSessions: totals.pricedSessions,
      tokens: totals.tokens,
      cost: totals.cost,
      costComplete: totals.pricedSessions === totals.sessionsWithUsage,
      cacheSavings: totals.cacheSavings,
      agents,
      models: Array.from(modelTokens.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label]) => label),
      lastActive: members.reduce(
        (latest, session) => (session.updatedAt > latest ? session.updatedAt : latest),
        first.updatedAt,
      ),
      tokenShare: 0,
      costShare: 0,
      members,
    });
  }
  const tokenTotal = stats.reduce((sum, stat) => sum + stat.tokens, 0);
  const costTotal = stats.reduce((sum, stat) => sum + stat.cost, 0);
  for (const stat of stats) {
    stat.tokenShare = tokenTotal ? (stat.tokens / tokenTotal) * 100 : 0;
    stat.costShare = costTotal ? (stat.cost / costTotal) * 100 : 0;
  }
  return stats.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
}
