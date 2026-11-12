import { useMemo, useState } from "react";
import type { SessionSummary, TimingEntry } from "../lib/types";
import { ACTIVE_TIME_HELP, timingCoverage, timingDuration, timingStats, type TimingStats } from "../lib/timing";
import { fullDate } from "../lib/utils";
import { Button, Tooltip } from "./ui";

const KIND: Record<TimingEntry["kind"], string> = { turn: "Turn", response: "Response", api: "API request" };

function Figure({ label, value, help }: { label: string; value: string; help?: string }) {
  return <div className="min-w-0 rounded-[12px] bg-sunken/50 p-3">
    <div className="text-11 text-muted">{help ? <Tooltip label={help}><span className="cursor-help border-b border-dotted border-line/20">{label}</span></Tooltip> : label}</div>
    <div className="mt-1 break-words text-13 font-semibold tabular text-fg">{value}</div>
  </div>;
}

function Averages({ stats }: { stats: TimingStats }) {
  if (!stats.averages.length) return <p className="text-12 text-faint">Response and API timing unavailable in these records.</p>;
  return <div className="space-y-2">
    {stats.averages.map((average) => <div key={average.kind} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-12">
      <span className="text-muted">Average completed {KIND[average.kind].toLowerCase()}</span>
      <span className="tabular text-fg">{timingDuration(average.averageMs)} <span className="text-faint">· {average.count} samples</span></span>
      {average.averageFirstTokenMs !== null && <span className="w-full text-11 text-faint">Average time to first token: {timingDuration(average.averageFirstTokenMs)} · {average.firstTokenCount} samples</span>}
    </div>)}
  </div>;
}

export function ProjectTiming({ period, lifetime }: { period: TimingStats; lifetime: TimingStats }) {
  return <section className="space-y-3 rounded-[18px] border border-line/[0.07] p-4">
    <h3 className="text-13 font-semibold text-fg">Project time</h3>
    <div className="grid grid-cols-2 gap-2.5">
      <Figure label="Est. active time · selected period" value={timingDuration(period.activeMs)} help={ACTIVE_TIME_HELP} />
      <Figure label="Est. active time · lifetime" value={timingDuration(lifetime.activeMs)} help={ACTIVE_TIME_HELP} />
      <Figure label="First recorded activity · lifetime" value={lifetime.firstActivity ? fullDate(lifetime.firstActivity) : "Unavailable"} />
      <Figure label="Last recorded activity · lifetime" value={lifetime.lastActivity ? fullDate(lifetime.lastActivity) : "Unavailable"} />
    </div>
    <p className="text-11 text-faint">Selected period: {timingCoverage(period)}. Lifetime: {timingCoverage(lifetime)}.</p>
    <Averages stats={period} />
    <p className="text-11 leading-relaxed text-faint">{ACTIVE_TIME_HELP} Turn and response durations may include tools and other agent work. Activity dates do not indicate project completion.</p>
  </section>;
}

export function SessionTimingSection({ session }: { session: SessionSummary }) {
  const timing = session.timing;
  const [expanded, setExpanded] = useState(false);
  const entries = timing?.entries ?? [];
  // Reuse the same aggregation rules as projects, with a single session.
  const stats = useMemo(() => timingStats([session]), [session]);
  const visible = expanded ? entries : entries.slice(0, 20);
  return <section className="space-y-3 rounded-[18px] border border-line/[0.07] bg-panel p-4">
    <h3 className="text-12 font-semibold text-fg">Timing</h3>
    <div className="grid grid-cols-2 gap-2.5">
      <Figure label="Elapsed time" value={timingDuration(timing?.elapsedMs)} help="First to last genuine recorded activity, including breaks." />
      <Figure label="Est. active time" value={timingDuration(stats.activeMs)} help={ACTIVE_TIME_HELP} />
    </div>
    <Averages stats={stats} />
    {visible.length > 0 && <div className="divide-y divide-line/[0.07]">
      {visible.map((entry) => <div key={`${entry.kind}:${entry.id}`} className="py-2.5 text-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium text-fg">{KIND[entry.kind]} · {entry.status}</span>
          <span className="tabular text-fg">{timingDuration(entry.durationMs)}</span>
        </div>
        <div className="mt-1 text-11 text-faint">{fullDate(entry.timestamp)} · {entry.source}</div>
        <div className="mt-0.5 truncate font-mono text-11 text-faint" title={entry.id}>{entry.id}</div>
        {entry.timeToFirstTokenMs !== null && <div className="mt-1 text-11 text-muted">Time to first token: {timingDuration(entry.timeToFirstTokenMs)}</div>}
      </div>)}
    </div>}
    {entries.length > 20 && <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show all ${entries.length} timings`}</Button>}
    <p className="text-11 leading-relaxed text-faint">{ACTIVE_TIME_HELP} Turn and response durations may include tools and other agent work. API request timing appears only when explicitly recorded.</p>
  </section>;
}
