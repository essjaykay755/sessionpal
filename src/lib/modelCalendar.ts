import { AGENT_ORDER } from "./agents";
import { canEstimateSessionCost, dateKey, hasDatedUsage } from "./analytics";
import { modelInfo, usageTokens } from "./pricing";
import type { AgentId, ModelUsage, SessionSummary } from "./types";
import { addDays, startOfDay } from "./utils";

export type CalendarViewMode = "week" | "month" | "year";
export type CalendarMetric = "tokens" | "cost";

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface ModelBucket {
  id: string;
  label: string;
  family: string;
  color: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  costKnown: boolean;
  pricedSessions: number;
  sessions: number;
  share: number;
  agents: AgentId[];
  firstDay: string;
  lastDay: string;
  activeDays: number;
}

export interface DaySessionRecord {
  session: SessionSummary;
  models: string[];
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
}

export interface CalendarDayRecord {
  key: string;
  year: number;
  month: number;
  dayOfMonth: number;
  /** 0 = Mon .. 6 = Sun */
  weekday: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  costComplete: boolean;
  sessionCount: number;
  models: ModelBucket[];
  sessions: DaySessionRecord[];
}

export interface MonthSummary {
  year: number;
  month: number;
  shortLabel: string;
  longLabel: string;
  tokens: number;
  cost: number;
  costComplete: boolean;
  activeDays: number;
  sessionCount: number;
  models: ModelBucket[];
}

export interface PeriodSummary {
  from: string;
  to: string;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  costComplete: boolean;
  pricedDays: number;
  activeDays: number;
  sessionCount: number;
  models: ModelBucket[];
  sessions: DaySessionRecord[];
}

export interface StreakInfo {
  current: number;
  longest: number;
  periodLongest: number;
  periodActiveDays: number;
  totalActiveDays: number;
}

export interface YearMonthGrid {
  year: number;
  month: number;
  name: string;
  shortName: string;
  /** Each week column has 7 slots (0 = Mon .. 6 = Sun), null outside the month. */
  weeks: Array<Array<string | null>>;
}

export interface MonthCell {
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
  weekday: number;
}

/** High-contrast harmonious fallback colors when two models share or closely match a swatch. */
const DISTINCT_PALETTE = [
  "#d46a49", // terracotta
  "#5678e5", // cobalt
  "#3d9b7b", // emerald
  "#8b6fd9", // iris
  "#cc9235", // amber
  "#389dc4", // cerulean
  "#cf6382", // rose
  "#82a148", // moss
  "#e08a58", // apricot
  "#549ee0", // sky
  "#68b59a", // mint
  "#a974cf", // orchid
  "#b85842", // rust
  "#4c89b8", // steel
  "#d4a83b", // ochre
  "#3e9e9b", // teal
  "#c45a9e", // magenta
  "#6f9e52", // sage
  "#e0756b", // coral
  "#6470c7", // periwinkle
  "#9e7f42", // bronze
  "#46a36e", // jade
  "#b5678e", // plum
  "#7b8db8", // slate-blue
];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 0 = Mon .. 6 = Sun */
export function isoWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function formatDayKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function shiftDayKey(key: string, deltaDays: number): string {
  return dateKey(addDays(parseDayKey(key), deltaDays));
}

export function startOfIsoWeek(key: string): string {
  const d = parseDayKey(key);
  return dateKey(addDays(d, -isoWeekday(d)));
}

export function buildWeekDays(anchorKey: string): string[] {
  const monday = parseDayKey(startOfIsoWeek(anchorKey));
  return Array.from({ length: 7 }, (_, i) => dateKey(addDays(monday, i)));
}

export function buildYearMonths(year: number): YearMonthGrid[] {
  return MONTH_LONG.map((name, month) => {
    const count = daysInMonth(year, month);
    const firstWd = isoWeekday(new Date(year, month, 1));
    const weeks: Array<Array<string | null>> = [];
    let currentWeek: Array<string | null> = Array.from({ length: 7 }, () => null);

    for (let day = 1; day <= count; day += 1) {
      const wd = (firstWd + day - 1) % 7;
      if (day > 1 && wd === 0) {
        weeks.push(currentWeek);
        currentWeek = Array.from({ length: 7 }, () => null);
      }
      currentWeek[wd] = formatDayKey(year, month, day);
    }
    weeks.push(currentWeek);

    return {
      year,
      month,
      name,
      shortName: MONTH_SHORT[month],
      weeks,
    };
  });
}

export function buildMonthMatrix(year: number, month: number): MonthCell[] {
  const first = new Date(year, month, 1);
  const leading = isoWeekday(first);
  const total = daysInMonth(year, month);
  const trailing = (7 - ((leading + total) % 7)) % 7;
  const cells: MonthCell[] = [];

  for (let i = -leading; i < total + trailing; i += 1) {
    const d = new Date(year, month, 1 + i);
    cells.push({
      key: dateKey(d),
      dayOfMonth: d.getDate(),
      inMonth: d.getMonth() === month && d.getFullYear() === year,
      weekday: isoWeekday(d),
    });
  }
  return cells;
}

/**
 * Assign each model in the library a deterministic, non-colliding color.
 * Models are ordered by total volume first so top models keep their canonical swatch.
 */
export function buildModelPalette(
  sessions: SessionSummary[],
): Map<string, { label: string; family: string; color: string }> {
  const totals = new Map<string, number>();
  const bump = (modelId: string, tokens: number) => {
    if (!modelId || tokens <= 0) return;
    totals.set(modelId, (totals.get(modelId) ?? 0) + tokens);
  };

  for (const session of sessions) {
    for (const item of sessionEntries(session)) {
      bump(item.model, usageTokens(item));
    }
  }

  const ordered = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  const used: string[] = [];
  const palette = new Map<string, { label: string; family: string; color: string }>();
  const MIN_DISTANCE = 54;
  let synthIndex = 0;

  const isDistinct = (candidate: string, threshold = MIN_DISTANCE) =>
    used.every((existing) => colorDistance(existing, candidate) >= threshold);

  for (const id of ordered) {
    const isMixed = id === "__multiple_models__";
    const info = isMixed
      ? { label: "Multiple models", family: "Mixed session", color: "#9c8f7e" }
      : modelInfo(id);
    let color = info.color.toLowerCase();
    if (!isDistinct(color)) {
      const alt =
        DISTINCT_PALETTE.find((candidate) => isDistinct(candidate.toLowerCase())) ??
        DISTINCT_PALETTE.find((candidate) => isDistinct(candidate.toLowerCase(), 32));
      if (alt) {
        color = alt.toLowerCase();
      } else {
        // Golden-angle hue stepping keeps extra models visually distinct.
        let generated = hslToHex(24 + synthIndex * 137.508, 0.56, 0.54);
        synthIndex += 1;
        while (!isDistinct(generated, 24) && synthIndex < 120) {
          generated = hslToHex(24 + synthIndex * 137.508, 0.54, synthIndex % 2 === 0 ? 0.52 : 0.62);
          synthIndex += 1;
        }
        color = generated;
      }
    }
    used.push(color);
    palette.set(id, {
      label: info.label,
      family: info.family,
      color,
    });
  }

  return palette;
}

interface NormalizedEntry {
  day: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
}

function sessionEntries(session: SessionSummary): NormalizedEntry[] {
  const entries: NormalizedEntry[] = [];
  if (hasDatedUsage(session)) {
    for (const day of session.usageDays ?? []) {
      if (day.models && day.models.length > 0) {
        for (const item of day.models) {
          if (usageTokens(item) <= 0) continue;
          entries.push({
            day: day.day,
            model: item.model,
            input: item.input,
            output: item.output,
            cacheRead: item.cacheRead,
            cacheWrite: item.cacheWrite,
            cost: item.cost,
          });
        }
      } else if (usageTokens(day) > 0) {
        const mixed = new Set(session.models.filter(Boolean)).size > 1;
        const model = mixed ? "__multiple_models__" : session.model || "unknown";
        entries.push({
          day: day.day,
          model,
          input: day.input,
          output: day.output,
          cacheRead: day.cacheRead,
          cacheWrite: day.cacheWrite,
          cost: canEstimateSessionCost(session) ? day.cost : null,
        });
      }
    }
    return entries;
  }

  const fallbackDay = dateKey(new Date(session.updatedAt));
  if (session.modelUsage && session.modelUsage.length > 0) {
    for (const item of session.modelUsage) {
      if (usageTokens(item) <= 0) continue;
      entries.push({
        day: fallbackDay,
        model: item.model,
        input: item.input,
        output: item.output,
        cacheRead: item.cacheRead,
        cacheWrite: item.cacheWrite,
        cost: item.cost,
      });
    }
    return entries;
  }

  if (session.usage && usageTokens(session.usage) > 0) {
    const mixed = new Set(session.models.filter(Boolean)).size > 1;
    const model = mixed ? "__multiple_models__" : session.model || "unknown";
    entries.push({
      day: fallbackDay,
      model,
      input: session.usage.input,
      output: session.usage.output,
      cacheRead: session.usage.cacheRead,
      cacheWrite: session.usage.cacheWrite,
      cost: canEstimateSessionCost(session) ? session.usage.cost : null,
    });
  }
  return entries;
}

interface RawModelAcc {
  id: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  costKnown: boolean;
  hasKnownCost: boolean;
  pricedSessions: Set<string>;
  sessions: Set<string>;
  agents: Set<AgentId>;
  days: Set<string>;
  firstDay: string;
  lastDay: string;
}

function finalizeModelBuckets(
  raw: Map<string, RawModelAcc>,
  palette: Map<string, { label: string; family: string; color: string }>,
  metric: CalendarMetric,
): ModelBucket[] {
  const list = Array.from(raw.values()).map((acc) => {
    const meta = palette.get(acc.id) ?? (() => {
      if (acc.id === "__multiple_models__") {
        return { label: "Multiple models", family: "Mixed session", color: "#9c8f7e" };
      }
      const info = modelInfo(acc.id);
      return { label: info.label, family: info.family, color: info.color };
    })();
    return {
      id: acc.id,
      label: meta.label,
      family: meta.family,
      color: meta.color,
      input: acc.input,
      output: acc.output,
      cacheRead: acc.cacheRead,
      cacheWrite: acc.cacheWrite,
      tokens: acc.tokens,
      cost: acc.cost,
      costKnown: acc.costKnown && acc.hasKnownCost,
      pricedSessions: acc.pricedSessions.size,
      sessions: acc.sessions.size,
      share: 0,
      agents: AGENT_ORDER.filter((agent) => acc.agents.has(agent)),
      firstDay: acc.firstDay,
      lastDay: acc.lastDay,
      activeDays: acc.days.size,
    } satisfies ModelBucket;
  });

  list.sort((a, b) => {
    if (metric === "cost") {
      const diff = (b.costKnown ? b.cost : -1) - (a.costKnown ? a.cost : -1);
      if (diff !== 0) return diff;
    }
    return b.tokens - a.tokens || a.label.localeCompare(b.label);
  });

  const denom = list.reduce(
    (sum, item) => sum + (metric === "cost" && item.costKnown ? item.cost : metric === "tokens" ? item.tokens : 0),
    0,
  ) || list.reduce((sum, item) => sum + item.tokens, 0);

  for (const item of list) {
    const val = metric === "cost" && item.costKnown ? item.cost : metric === "tokens" ? item.tokens : 0;
    item.share = denom > 0 ? (val / denom) * 100 : 0;
  }
  return list;
}

export interface CalendarFilters {
  agent?: AgentId | "all";
  modelId?: string | null;
  metric?: CalendarMetric;
}

/** Build the complete historical day index across all local sessions. */
export function buildCalendarIndex(
  sessions: SessionSummary[],
  palette: Map<string, { label: string; family: string; color: string }>,
  filters: CalendarFilters = {},
): Map<string, CalendarDayRecord> {
  const agentFilter = filters.agent ?? "all";
  const modelFilter = filters.modelId ?? null;
  const metric = filters.metric ?? "tokens";

  interface DayAcc {
    key: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tokens: number;
    cost: number;
    costComplete: boolean;
    models: Map<string, RawModelAcc>;
    sessions: Map<string, DaySessionRecord>;
  }

  const days = new Map<string, DayAcc>();

  for (const session of sessions) {
    if (agentFilter !== "all" && session.agent !== agentFilter) continue;
    const entries = sessionEntries(session);
    for (const entry of entries) {
      if (modelFilter && entry.model !== modelFilter) continue;
      const tokens = usageTokens(entry);
      if (tokens <= 0) continue;

      let dayAcc = days.get(entry.day);
      if (!dayAcc) {
        dayAcc = {
          key: entry.day,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          tokens: 0,
          cost: 0,
          costComplete: true,
          models: new Map(),
          sessions: new Map(),
        };
        days.set(entry.day, dayAcc);
      }

      dayAcc.input += entry.input;
      dayAcc.output += entry.output;
      dayAcc.cacheRead += entry.cacheRead;
      dayAcc.cacheWrite += entry.cacheWrite;
      dayAcc.tokens += tokens;
      if (entry.cost !== null) {
        dayAcc.cost += entry.cost;
      } else {
        dayAcc.costComplete = false;
      }

      let modelAcc = dayAcc.models.get(entry.model);
      if (!modelAcc) {
        modelAcc = {
          id: entry.model,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          tokens: 0,
          cost: 0,
          costKnown: true,
          hasKnownCost: false,
          pricedSessions: new Set(),
          sessions: new Set(),
          agents: new Set(),
          days: new Set(),
          firstDay: entry.day,
          lastDay: entry.day,
        };
        dayAcc.models.set(entry.model, modelAcc);
      }
      modelAcc.input += entry.input;
      modelAcc.output += entry.output;
      modelAcc.cacheRead += entry.cacheRead;
      modelAcc.cacheWrite += entry.cacheWrite;
      modelAcc.tokens += tokens;
      modelAcc.sessions.add(session.id);
      modelAcc.agents.add(session.agent);
      modelAcc.days.add(entry.day);
      if (entry.cost !== null) {
        modelAcc.cost += entry.cost;
        modelAcc.hasKnownCost = true;
        modelAcc.pricedSessions.add(session.id);
      } else {
        modelAcc.costKnown = false;
      }

      let sessAcc = dayAcc.sessions.get(session.id);
      if (!sessAcc) {
        sessAcc = {
          session,
          models: [],
          tokens: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
        };
        dayAcc.sessions.set(session.id, sessAcc);
      }
      if (!sessAcc.models.includes(entry.model)) sessAcc.models.push(entry.model);
      sessAcc.tokens += tokens;
      sessAcc.input += entry.input;
      sessAcc.output += entry.output;
      sessAcc.cacheRead += entry.cacheRead;
      sessAcc.cacheWrite += entry.cacheWrite;
      sessAcc.cost = sessAcc.cost === null || entry.cost === null ? null : sessAcc.cost + entry.cost;
    }
  }

  const index = new Map<string, CalendarDayRecord>();
  for (const [key, acc] of days) {
    const parsed = parseDayKey(key);
    const models = finalizeModelBuckets(acc.models, palette, metric);
    const sessionList = Array.from(acc.sessions.values()).sort(
      (a, b) =>
        (metric === "cost" ? (b.cost ?? -1) - (a.cost ?? -1) : 0) ||
        b.tokens - a.tokens ||
        b.session.updatedAt.localeCompare(a.session.updatedAt),
    );
    index.set(key, {
      key,
      year: parsed.getFullYear(),
      month: parsed.getMonth(),
      dayOfMonth: parsed.getDate(),
      weekday: isoWeekday(parsed),
      tokens: acc.tokens,
      input: acc.input,
      output: acc.output,
      cacheRead: acc.cacheRead,
      cacheWrite: acc.cacheWrite,
      cost: acc.cost,
      costComplete: acc.costComplete,
      sessionCount: sessionList.length,
      models,
      sessions: sessionList,
    });
  }

  return index;
}

export function availableYears(
  index: Map<string, CalendarDayRecord>,
  now = Date.now(),
): number[] {
  const currentYear = new Date(now).getFullYear();
  let minYear = currentYear;
  let maxYear = currentYear;
  for (const record of index.values()) {
    if (record.year < minYear) minYear = record.year;
    if (record.year > maxYear) maxYear = record.year;
  }
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y += 1) years.push(y);
  return years;
}

export function summarizePeriod(
  index: Map<string, CalendarDayRecord>,
  from: string,
  to: string,
  palette: Map<string, { label: string; family: string; color: string }>,
  metric: CalendarMetric = "tokens",
): PeriodSummary {
  let tokens = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let costComplete = true;
  let pricedDays = 0;
  let activeDays = 0;

  const modelMap = new Map<string, RawModelAcc>();
  const sessionMap = new Map<string, DaySessionRecord>();

  for (const record of index.values()) {
    if (record.key < from || record.key > to) continue;
    if (record.tokens <= 0) continue;
    activeDays += 1;
    tokens += record.tokens;
    input += record.input;
    output += record.output;
    cacheRead += record.cacheRead;
    cacheWrite += record.cacheWrite;
    cost += record.cost;
    if (record.costComplete && record.cost > 0) pricedDays += 1;
    else if (!record.costComplete) costComplete = false;

    for (const model of record.models) {
      let acc = modelMap.get(model.id);
      if (!acc) {
        acc = {
          id: model.id,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          tokens: 0,
          cost: 0,
          costKnown: true,
          hasKnownCost: false,
          pricedSessions: new Set(),
          sessions: new Set(),
          agents: new Set(),
          days: new Set(),
          firstDay: record.key,
          lastDay: record.key,
        };
        modelMap.set(model.id, acc);
      }
      acc.input += model.input;
      acc.output += model.output;
      acc.cacheRead += model.cacheRead;
      acc.cacheWrite += model.cacheWrite;
      acc.tokens += model.tokens;
      acc.cost += model.cost;
      if (model.costKnown) acc.hasKnownCost = true;
      else acc.costKnown = false;
      for (const agent of model.agents) acc.agents.add(agent);
      acc.days.add(record.key);
      if (record.key < acc.firstDay) acc.firstDay = record.key;
      if (record.key > acc.lastDay) acc.lastDay = record.key;
    }

    for (const sess of record.sessions) {
      for (const modelId of sess.models) {
        const m = modelMap.get(modelId);
        if (m) {
          m.sessions.add(sess.session.id);
          if (sess.cost !== null) m.pricedSessions.add(sess.session.id);
        }
      }
      const existing = sessionMap.get(sess.session.id);
      if (!existing) {
        sessionMap.set(sess.session.id, {
          ...sess,
          models: [...sess.models],
        });
      } else {
        for (const modelId of sess.models) {
          if (!existing.models.includes(modelId)) existing.models.push(modelId);
        }
        existing.tokens += sess.tokens;
        existing.input += sess.input;
        existing.output += sess.output;
        existing.cacheRead += sess.cacheRead;
        existing.cacheWrite += sess.cacheWrite;
        existing.cost =
          existing.cost === null || sess.cost === null ? null : existing.cost + sess.cost;
      }
    }
  }

  const models = finalizeModelBuckets(modelMap, palette, metric);
  const sessions = Array.from(sessionMap.values()).sort(
    (a, b) =>
      (metric === "cost" ? (b.cost ?? -1) - (a.cost ?? -1) : 0) ||
      b.tokens - a.tokens ||
      b.session.updatedAt.localeCompare(a.session.updatedAt),
  );

  return {
    from,
    to,
    tokens,
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
    costComplete: activeDays > 0 && costComplete,
    pricedDays,
    activeDays,
    sessionCount: sessions.length,
    models,
    sessions,
  };
}

export function buildMonthlySummaries(
  year: number,
  index: Map<string, CalendarDayRecord>,
  palette: Map<string, { label: string; family: string; color: string }>,
  metric: CalendarMetric = "tokens",
): MonthSummary[] {
  return MONTH_SHORT.map((shortLabel, month) => {
    const from = formatDayKey(year, month, 1);
    const to = formatDayKey(year, month, daysInMonth(year, month));
    const summary = summarizePeriod(index, from, to, palette, metric);
    return {
      year,
      month,
      shortLabel,
      longLabel: MONTH_LONG[month],
      tokens: summary.tokens,
      cost: summary.cost,
      costComplete: summary.costComplete,
      activeDays: summary.activeDays,
      sessionCount: summary.sessionCount,
      models: summary.models,
    };
  });
}

export function computeStreaks(
  index: Map<string, CalendarDayRecord>,
  periodFrom: string,
  periodTo: string,
  now = Date.now(),
): StreakInfo {
  const activeKeys = Array.from(index.values())
    .filter((day) => day.tokens > 0)
    .map((day) => day.key)
    .sort();

  const activeSet = new Set(activeKeys);
  const todayKey = dateKey(startOfDay(now));
  const yesterdayKey = shiftDayKey(todayKey, -1);

  let current = 0;
  let cursor = activeSet.has(todayKey) ? todayKey : activeSet.has(yesterdayKey) ? yesterdayKey : null;
  while (cursor && activeSet.has(cursor)) {
    current += 1;
    cursor = shiftDayKey(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of activeKeys) {
    if (prev && shiftDayKey(prev, 1) === key) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prev = key;
  }

  let periodLongest = 0;
  let periodRun = 0;
  let periodPrev: string | null = null;
  let periodActiveDays = 0;
  for (const key of activeKeys) {
    if (key < periodFrom || key > periodTo) continue;
    periodActiveDays += 1;
    if (periodPrev && shiftDayKey(periodPrev, 1) === key) {
      periodRun += 1;
    } else {
      periodRun = 1;
    }
    if (periodRun > periodLongest) periodLongest = periodRun;
    periodPrev = key;
  }

  return {
    current,
    longest,
    periodLongest,
    periodActiveDays,
    totalActiveDays: activeKeys.length,
  };
}

/**
 * Perceptual intensity scale (0.34 .. 1.0) using the 92nd percentile daily value
 * so a single huge outlier day never washes out regular coding days.
 */
export function computeIntensityReference(
  index: Map<string, CalendarDayRecord>,
  from: string,
  to: string,
  metric: CalendarMetric,
): number {
  const values: number[] = [];
  for (const day of index.values()) {
    if (day.key < from || day.key > to) continue;
    const val = metric === "cost" ? day.cost : day.tokens;
    if (val > 0) values.push(val);
  }
  if (values.length === 0) return 1;
  values.sort((a, b) => a - b);
  const idx = Math.min(values.length - 1, Math.floor(values.length * 0.92));
  return Math.max(values[idx], values[values.length - 1] * 0.25, 1e-6);
}

export function dayIntensity(value: number, reference: number): number {
  if (value <= 0 || reference <= 0) return 0;
  const ratio = Math.min(1, value / reference);
  return 0.36 + Math.pow(ratio, 0.55) * 0.64;
}

/**
 * Produces a solid fill for single-model days or a sharp 135° proportional
 * diagonal split for multi-model days (matching the multi-tone cells in the heatmap).
 */
export function dayCellBackground(models: ModelBucket[]): string | undefined {
  if (models.length === 0) return undefined;
  if (models.length === 1) return models[0].color;

  const significant = models.filter((m) => m.share >= 6).slice(0, 3);
  if (significant.length <= 1) return models[0].color;

  const totalShare = significant.reduce((sum, m) => sum + m.share, 0) || 100;
  const stops: string[] = [];
  let cursor = 0;
  for (let i = 0; i < significant.length; i += 1) {
    const start = Math.round(cursor);
    const next = i === significant.length - 1 ? 100 : Math.round(cursor + (significant[i].share / totalShare) * 100);
    stops.push(`${significant[i].color} ${start}% ${next}%`);
    cursor += (significant[i].share / totalShare) * 100;
  }
  return `linear-gradient(135deg, ${stops.join(", ")})`;
}

export function formatPeriodLabel(
  mode: CalendarViewMode,
  year: number,
  month: number,
  weekAnchor: string,
): string {
  if (mode === "year") return String(year);
  if (mode === "month") return `${MONTH_LONG[month]} ${year}`;
  const days = buildWeekDays(weekAnchor);
  const start = parseDayKey(days[0]);
  const end = parseDayKey(days[6]);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (sameYear) {
    return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

export function compactShort(value: number): string {
  if (value >= 1_000_000_000) {
    const v = value / 1_000_000_000;
    return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(0) : v.toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    const v = value / 1_000_000;
    return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const v = value / 1_000;
    return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return String(Math.round(value));
}
