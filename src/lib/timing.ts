import type { DayWindow } from "./analytics";
import type { SessionSummary, TimingEntry } from "./types";

export const ACTIVE_TIME_HELP = "Estimated AI-session activity: count gaps of 15 minutes or less between recorded events; exclude longer breaks. Overlapping sessions in a project count once. This does not include all work in your editor.";

export interface TimingAverage {
  kind: TimingEntry["kind"];
  count: number;
  averageMs: number;
  firstTokenCount: number;
  averageFirstTokenMs: number | null;
}

export interface TimingStats {
  activeMs: number | null;
  coveredSessions: number;
  totalSessions: number;
  firstActivity: string | null;
  lastActivity: string | null;
  averages: TimingAverage[];
}

/** Use local calendar boundaries, including DST, to match Usage ranges. */
function bounds(window?: DayWindow): [number, number] {
  if (!window) return [-Infinity, Infinity];
  const start = new Date(`${window.from}T00:00:00`);
  const end = new Date(`${window.to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}

export function timingStats(sessions: SessionSummary[], window?: DayWindow): TimingStats {
  const [from, to] = bounds(window);
  const intervals: Array<[number, number]> = [];
  const entries: TimingEntry[] = [];
  let coveredSessions = 0;
  let totalSessions = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const session of sessions) {
    const timing = session.timing;
    const start = Date.parse(timing?.firstActivity ?? session.createdAt);
    const end = Date.parse(timing?.lastActivity ?? session.updatedAt);
    if (end < from || start >= to) continue;
    totalSessions += 1;
    if (!timing) continue;
    if (Number.isFinite(start)) first = Math.min(first, start);
    if (Number.isFinite(end)) last = Math.max(last, end);
    // Coverage describes sessions with enough real timestamps to estimate time,
    // including a known zero when all of their gaps exceed the threshold.
    if (timing.eventCount >= 2) coveredSessions += 1;
    for (const interval of timing.activityIntervals) {
      if (!Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs)) continue;
      const a = Math.max(from, interval.startMs);
      const b = Math.min(to, interval.endMs);
      if (b > a) intervals.push([a, b]);
    }
    const seen = new Set<string>();
    for (const entry of timing.entries) {
      const key = `${entry.kind}:${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const stamp = Date.parse(entry.timestamp);
      if (stamp >= from && stamp < to && entry.status === "completed"
        && Number.isFinite(entry.durationMs) && entry.durationMs >= 0) entries.push(entry);
    }
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let activeMs = 0;
  let end = -Infinity;
  for (const [a, b] of intervals) {
    activeMs += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  const averages = (["turn", "response", "api"] as const).flatMap((kind) => {
    const samples = entries.filter((entry) => entry.kind === kind);
    if (!samples.length) return [];
    const firstTokens = samples.flatMap((entry) => entry.timeToFirstTokenMs !== null
      && Number.isFinite(entry.timeToFirstTokenMs) && entry.timeToFirstTokenMs >= 0
      && entry.timeToFirstTokenMs <= entry.durationMs ? [entry.timeToFirstTokenMs] : []);
    return [{ kind, count: samples.length,
      averageMs: samples.reduce((sum, entry) => sum + entry.durationMs, 0) / samples.length,
      firstTokenCount: firstTokens.length,
      averageFirstTokenMs: firstTokens.length ? firstTokens.reduce((sum, ms) => sum + ms, 0) / firstTokens.length : null,
    }];
  });
  return { activeMs: coveredSessions ? activeMs : null, coveredSessions, totalSessions,
    firstActivity: Number.isFinite(first) ? new Date(first).toISOString() : null,
    lastActivity: Number.isFinite(last) ? new Date(last).toISOString() : null, averages };
}

export function timingDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "Unavailable";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

export function timingCoverage(stats: TimingStats): string {
  return `${stats.coveredSessions} of ${stats.totalSessions} sessions timed${stats.coveredSessions < stats.totalSessions ? " · Partial data" : ""}`;
}
