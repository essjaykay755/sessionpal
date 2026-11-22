import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Fire,
  FunnelSimple,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { AGENT_CLASS, AGENTS, AGENT_ORDER } from "../lib/agents";
import { dateKey } from "../lib/analytics";
import {
  availableYears,
  buildCalendarIndex,
  buildModelPalette,
  buildMonthMatrix,
  buildMonthlySummaries,
  buildWeekDays,
  buildYearMonths,
  compactShort,
  computeIntensityReference,
  computeStreaks,
  dayCellBackground,
  dayIntensity,
  daysInMonth,
  formatDayKey,
  formatPeriodLabel,
  MONTH_LONG,
  MONTH_SHORT,
  parseDayKey,
  shiftDayKey,
  startOfIsoWeek,
  summarizePeriod,
  WEEKDAY_LABELS,
  type CalendarDayRecord,
  type CalendarMetric,
  type CalendarViewMode,
  type ModelBucket,
  type MonthSummary,
} from "../lib/modelCalendar";
import { useApp } from "../lib/store";
import type { AgentId } from "../lib/types";
import { cn, compact, money, number, pct, shortDate } from "../lib/utils";
import { AgentMark } from "./Brand";
import { Button, Segmented, Tooltip } from "./ui";

interface ModelHistoryViewProps {
  /** Optional model ID pre-selected when jumping from "Models in use". */
  initialModelId?: string | null;
  onConsumeInitialModel?: () => void;
}

type HoverPreview =
  | { kind: "day"; key: string; record: CalendarDayRecord | null; rect: DOMRect }
  | { kind: "month"; summary: MonthSummary; rect: DOMRect };

export function ModelHistoryView({
  initialModelId,
  onConsumeInitialModel,
}: ModelHistoryViewProps) {
  const { sessions, settings, openSession, navigate } = useApp();

  const todayKey = useMemo(() => dateKey(new Date()), []);
  const todayDate = useMemo(() => parseDayKey(todayKey), [todayKey]);

  const [mode, setMode] = useState<CalendarViewMode>("year");
  const [year, setYear] = useState<number>(() => todayDate.getFullYear());
  const [month, setMonth] = useState<number>(() => todayDate.getMonth());
  const [weekAnchor, setWeekAnchor] = useState<string>(() => todayKey);
  const [metric, setMetric] = useState<CalendarMetric>("tokens");
  const [agentFilter, setAgentFilter] = useState<AgentId | "all">("all");
  const [modelFilter, setModelFilter] = useState<string | null>(initialModelId ?? null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [hovered, setHovered] = useState<HoverPreview | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const monthRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (initialModelId) {
      setModelFilter(initialModelId);
      setSelectedDay(null);
      setSelectedMonth(null);
      onConsumeInitialModel?.();
    }
  }, [initialModelId, onConsumeInitialModel]);

  // Reset expanded sessions toggle when changing inspection scope.
  useEffect(() => {
    setShowAllSessions(false);
  }, [selectedDay, selectedMonth, year, month, weekAnchor, mode, modelFilter, agentFilter]);

  const palette = useMemo(() => buildModelPalette(sessions), [sessions]);

  // Unfiltered-by-model index for building the model legend pills in the current period.
  const baseIndex = useMemo(
    () => buildCalendarIndex(sessions, palette, { agent: agentFilter, metric }),
    [sessions, palette, agentFilter, metric],
  );

  // Active index honoring both agent + model filter.
  const index = useMemo(
    () =>
      modelFilter
        ? buildCalendarIndex(sessions, palette, { agent: agentFilter, modelId: modelFilter, metric })
        : baseIndex,
    [sessions, palette, agentFilter, modelFilter, metric, baseIndex],
  );

  const years = useMemo(() => availableYears(baseIndex), [baseIndex]);
  const minYear = years[0] ?? todayDate.getFullYear();
  const maxYear = years[years.length - 1] ?? todayDate.getFullYear();

  const activeAgents = useMemo(() => {
    const set = new Set<AgentId>();
    for (const s of sessions) {
      if (s.usage || (s.usageDays && s.usageDays.length > 0)) set.add(s.agent);
    }
    return AGENT_ORDER.filter((id) => set.has(id));
  }, [sessions]);

  // Active period boundaries for the visible calendar canvas.
  const periodRange = useMemo(() => {
    if (mode === "year") {
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    if (mode === "month") {
      return {
        from: formatDayKey(year, month, 1),
        to: formatDayKey(year, month, daysInMonth(year, month)),
      };
    }
    const days = buildWeekDays(weekAnchor);
    return { from: days[0], to: days[6] };
  }, [mode, year, month, weekAnchor]);

  // Effective metric: fall back to tokens when costs are hidden or no priced data exists.
  const periodUnfiltered = useMemo(
    () => summarizePeriod(baseIndex, periodRange.from, periodRange.to, palette, metric),
    [baseIndex, periodRange, palette, metric],
  );
  const canShowCost = settings.showCosts && periodUnfiltered.cost > 0;
  const displayedMetric: CalendarMetric = canShowCost ? metric : "tokens";

  const periodSummary = useMemo(
    () => summarizePeriod(index, periodRange.from, periodRange.to, palette, displayedMetric),
    [index, periodRange, palette, displayedMetric],
  );

  const yearMonths = useMemo(() => buildYearMonths(year), [year]);
  const monthlySummaries = useMemo(
    () => buildMonthlySummaries(year, index, palette, displayedMetric),
    [year, index, palette, displayedMetric],
  );
  const monthCells = useMemo(() => buildMonthMatrix(year, month), [year, month]);
  const weekDays = useMemo(() => buildWeekDays(weekAnchor), [weekAnchor]);

  const streaks = useMemo(
    () => computeStreaks(index, periodRange.from, periodRange.to),
    [index, periodRange],
  );

  const intensityRef = useMemo(
    () => computeIntensityReference(index, periodRange.from, periodRange.to, displayedMetric),
    [index, periodRange, displayedMetric],
  );

  // Auto-scroll Year view so the latest active month (or current month) sits cleanly in view.
  useEffect(() => {
    if (mode !== "year") return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const targetMonth =
      selectedMonth ??
      (year === todayDate.getFullYear()
        ? todayDate.getMonth()
        : [...monthlySummaries].reverse().find((m) => m.tokens > 0)?.month ?? 11);
    const node = monthRefs.current[targetMonth];
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      const targetLeft = Math.max(0, node.offsetLeft + node.offsetWidth - scroller.clientWidth + 24);
      scroller.scrollTo({ left: targetLeft, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, year, todayDate]); // intentionally only on mode/year switch

  const scrollToMonth = (targetMonth: number) => {
    const scroller = scrollerRef.current;
    const node = monthRefs.current[targetMonth];
    if (!scroller || !node) return;
    const left = Math.max(0, node.offsetLeft - scroller.clientWidth / 2 + node.offsetWidth / 2);
    scroller.scrollTo({ left, behavior: "smooth" });
  };

  // All active day keys in the current visible period, for prev/next active day stepping.
  const activePeriodDays = useMemo(() => {
    const list: string[] = [];
    for (const day of index.values()) {
      if (day.key >= periodRange.from && day.key <= periodRange.to && day.tokens > 0) {
        list.push(day.key);
      }
    }
    return list.sort();
  }, [index, periodRange]);

  // Compute the active inspection scope for the Detailed Historical Records panel below.
  const inspection = useMemo(() => {
    if (selectedDay) {
      const summary = summarizePeriod(index, selectedDay, selectedDay, palette, displayedMetric);
      const parsed = parseDayKey(selectedDay);
      return {
        kind: "day" as const,
        title: parsed.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        subtitle: selectedDay === todayKey ? "Today" : undefined,
        summary,
      };
    }
    if (mode === "year" && selectedMonth !== null) {
      const from = formatDayKey(year, selectedMonth, 1);
      const to = formatDayKey(year, selectedMonth, daysInMonth(year, selectedMonth));
      return {
        kind: "month" as const,
        title: `${MONTH_LONG[selectedMonth]} ${year}`,
        subtitle: "Selected month",
        summary: summarizePeriod(index, from, to, palette, displayedMetric),
      };
    }
    return {
      kind: mode,
      title:
        mode === "year"
          ? `All of ${year}`
          : mode === "month"
            ? `${MONTH_LONG[month]} ${year}`
            : formatPeriodLabel("week", year, month, weekAnchor),
      subtitle:
        mode === "year"
          ? "Full year record"
          : mode === "month"
            ? "Monthly record"
            : "Weekly record",
      summary: periodSummary,
    };
  }, [
    selectedDay,
    selectedMonth,
    mode,
    year,
    month,
    weekAnchor,
    index,
    palette,
    displayedMetric,
    periodSummary,
    todayKey,
  ]);

  const isAtCurrentPeriod = useMemo(() => {
    if (mode === "year") return year === todayDate.getFullYear();
    if (mode === "month") return year === todayDate.getFullYear() && month === todayDate.getMonth();
    return startOfIsoWeek(weekAnchor) === startOfIsoWeek(todayKey);
  }, [mode, year, month, weekAnchor, todayDate, todayKey]);

  const canStepNext = useMemo(() => {
    if (mode === "year") return year < maxYear;
    if (mode === "month") {
      return year < todayDate.getFullYear() || (year === todayDate.getFullYear() && month < todayDate.getMonth());
    }
    return startOfIsoWeek(weekAnchor) < startOfIsoWeek(todayKey);
  }, [mode, year, month, weekAnchor, maxYear, todayDate, todayKey]);

  const canStepPrev = useMemo(() => {
    if (mode === "year") return year > minYear;
    if (mode === "month") return year > minYear || month > 0;
    return parseDayKey(weekAnchor).getFullYear() >= minYear;
  }, [mode, year, month, weekAnchor, minYear]);

  const stepPeriod = (delta: -1 | 1) => {
    setSelectedDay(null);
    setSelectedMonth(null);
    if (mode === "year") {
      setYear((current) => Math.max(minYear, Math.min(maxYear, current + delta)));
      return;
    }
    if (mode === "month") {
      const next = new Date(year, month + delta, 1);
      setYear(next.getFullYear());
      setMonth(next.getMonth());
      return;
    }
    const nextAnchor = shiftDayKey(weekAnchor, delta * 7);
    setWeekAnchor(nextAnchor);
    const parsed = parseDayKey(nextAnchor);
    setYear(parsed.getFullYear());
    setMonth(parsed.getMonth());
  };

  const jumpToToday = () => {
    setSelectedDay(null);
    setSelectedMonth(null);
    setYear(todayDate.getFullYear());
    setMonth(todayDate.getMonth());
    setWeekAnchor(todayKey);
    if (mode === "year") scrollToMonth(todayDate.getMonth());
  };

  const switchMode = (next: CalendarViewMode) => {
    if (next === mode) return;
    if (next === "month") {
      if (selectedDay) {
        const d = parseDayKey(selectedDay);
        setYear(d.getFullYear());
        setMonth(d.getMonth());
      } else if (selectedMonth !== null) {
        setMonth(selectedMonth);
      } else if (year === todayDate.getFullYear()) {
        setMonth(todayDate.getMonth());
      } else {
        const latest = [...monthlySummaries].reverse().find((m) => m.tokens > 0);
        setMonth(latest ? latest.month : 0);
      }
      setSelectedMonth(null);
    } else if (next === "week") {
      if (selectedDay) {
        setWeekAnchor(selectedDay);
      } else if (mode === "month") {
        const inThisMonth =
          year === todayDate.getFullYear() && month === todayDate.getMonth()
            ? todayKey
            : formatDayKey(year, month, 1);
        setWeekAnchor(inThisMonth);
      } else {
        setWeekAnchor(year === todayDate.getFullYear() ? todayKey : `${year}-12-28`);
      }
      setSelectedMonth(null);
    } else {
      setSelectedMonth(null);
    }
    setMode(next);
  };

  const handleSelectDay = (dayKey: string) => {
    setSelectedMonth(null);
    setSelectedDay((current) => (current === dayKey ? null : dayKey));
  };

  const handleSelectMonthBar = (targetMonth: number) => {
    setSelectedDay(null);
    setSelectedMonth((current) => {
      const next = current === targetMonth ? null : targetMonth;
      if (next !== null) scrollToMonth(next);
      return next;
    });
  };

  const handleScrollerWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const node = scrollerRef.current;
    if (!node) return;
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && node.scrollWidth > node.clientWidth) {
      node.scrollLeft += event.deltaY;
    }
  };

  const formatMetricValue = (tokens: number, cost: number, short = false) => {
    if (displayedMetric === "cost") {
      if (cost <= 0) return "—";
      if (short) {
        if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}k`;
        if (cost >= 10) return `$${Math.round(cost)}`;
        return `$${cost.toFixed(1)}`;
      }
      return money(cost);
    }
    if (tokens <= 0) return "—";
    return short ? compactShort(tokens) : compact(tokens);
  };

  const legendModels = periodUnfiltered.models;
  const visibleLegendModels = showAllModels ? legendModels : legendModels.slice(0, 4);
  const selectedModelMeta = modelFilter ? palette.get(modelFilter) : null;

  const activeDayPosition = selectedDay ? activePeriodDays.indexOf(selectedDay) : -1;

  // Bar scaling for "By month" (Year view)
  const maxMonthVal = useMemo(() => {
    const vals = monthlySummaries.map((m) => (displayedMetric === "cost" ? m.cost : m.tokens));
    return Math.max(1, ...vals);
  }, [monthlySummaries, displayedMetric]);

  // Bar scaling for "By day" (Month view)
  const monthDaysList = useMemo(() => {
    const total = daysInMonth(year, month);
    return Array.from({ length: total }, (_, idx) => {
      const key = formatDayKey(year, month, idx + 1);
      return { day: idx + 1, key, record: index.get(key) ?? null };
    });
  }, [year, month, index]);

  const maxMonthDayVal = useMemo(() => {
    const vals = monthDaysList.map((d) =>
      d.record ? (displayedMetric === "cost" ? d.record.cost : d.record.tokens) : 0,
    );
    return Math.max(1, ...vals);
  }, [monthDaysList, displayedMetric]);

  const maxWeekVal = useMemo(() => {
    const vals = weekDays.map((key) => {
      const rec = index.get(key);
      return rec ? (displayedMetric === "cost" ? rec.cost : rec.tokens) : 0;
    });
    return Math.max(1, ...vals);
  }, [weekDays, index, displayedMetric]);

  const periodTotalLabel = useMemo(() => {
    const val = formatMetricValue(periodSummary.tokens, periodSummary.cost);
    const suffix =
      mode === "year"
        ? `in ${year}`
        : mode === "month"
          ? `in ${MONTH_SHORT[month]} ${year}`
          : "this week";
    if (selectedModelMeta) {
      return `${val} · ${selectedModelMeta.label} ${suffix}`;
    }
    return `${val} ${suffix}`;
  }, [periodSummary, displayedMetric, mode, year, month, selectedModelMeta]);

  const highlightedMonthIndex =
    selectedMonth ?? (year === todayDate.getFullYear() ? todayDate.getMonth() : null);

  return (
    <div className="space-y-4">
      {/* Main Calendar & Monthly Chart Card */}
      <section className="card overflow-hidden">
        {/* Top Control Bar: < 2026 >   🔥 99   [Week | Month | Year] */}
        <div
          role="toolbar"
          aria-label="Model history calendar controls"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-line/[0.06] px-4 py-3.5 sm:px-6"
        >
          {/* Left: Period stepper pill */}
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Period navigation"
              className="inline-flex h-9 items-center rounded-full border border-line/[0.08] bg-sunken/70 p-0.5 dark:bg-white/[0.045]"
            >
              <button
                type="button"
                aria-label={`Previous ${mode}`}
                disabled={!canStepPrev}
                onClick={() => stepPeriod(-1)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-line/[0.06] hover:text-fg disabled:pointer-events-none disabled:opacity-30"
              >
                <CaretLeft className="h-3.5 w-3.5" weight="bold" />
              </button>
              <span className="h-4 w-px bg-line/[0.08]" aria-hidden="true" />
              <span className="min-w-[74px] px-3 text-center text-13 font-bold tabular tracking-[-0.02em] text-fg">
                {formatPeriodLabel(mode, year, month, weekAnchor)}
              </span>
              <span className="h-4 w-px bg-line/[0.08]" aria-hidden="true" />
              <button
                type="button"
                aria-label={`Next ${mode}`}
                disabled={!canStepNext}
                onClick={() => stepPeriod(1)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-line/[0.06] hover:text-fg disabled:pointer-events-none disabled:opacity-30"
              >
                <CaretRight className="h-3.5 w-3.5" weight="bold" />
              </button>
            </div>

            {!isAtCurrentPeriod && (
              <button
                type="button"
                onClick={jumpToToday}
                className="h-8 rounded-full border border-line/[0.08] px-3 text-11 font-medium text-muted transition-colors hover:bg-sunken/70 hover:text-fg"
              >
                Today
              </button>
            )}
          </div>

          {/* Center: Streak pill */}
          <Tooltip
            side="bottom"
            label={`Current streak: ${streaks.current} ${streaks.current === 1 ? "day" : "days"} · Best streak: ${streaks.longest} days · ${streaks.periodActiveDays} active days in view`}
          >
            <div
              className="inline-flex h-9 cursor-default items-center gap-1.5 rounded-full border border-line/[0.08] bg-sunken/70 px-3.5 text-13 font-bold tabular text-fg dark:bg-white/[0.055]"
              aria-label={`${streaks.current} day active streak`}
            >
              <Fire
                className={cn(
                  "h-4 w-4",
                  streaks.current > 0 ? "text-copper-500 dark:text-copper-300" : "text-faint",
                )}
                weight="fill"
              />
              <span>{number(streaks.current)}</span>
            </div>
          </Tooltip>

          {/* Right: Week | Month | Year switcher */}
          <Segmented
            value={mode}
            onChange={switchMode}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
            ]}
            className="h-9 bg-sunken/70 p-1 dark:bg-white/[0.045]"
          />
        </div>

        {/* Filter & Model Legend Bar */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line/[0.055] bg-sunken/25 px-4 py-2.5 sm:px-6 dark:bg-white/[0.015]">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={modelFilter === null}
              onClick={() => setModelFilter(null)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-11 font-medium transition-colors",
                modelFilter === null
                  ? "bg-fg text-canvas"
                  : "border border-line/[0.08] bg-panel text-muted hover:text-fg",
              )}
            >
              All models
              <span className={cn("tabular", modelFilter === null ? "opacity-75" : "text-faint")}>
                {legendModels.length}
              </span>
            </button>

            {visibleLegendModels.map((model) => {
              const active = modelFilter === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setModelFilter((current) => (current === model.id ? null : model.id))}
                  className={cn(
                    "inline-flex h-7 max-w-[190px] items-center gap-1.5 rounded-full border px-2.5 text-11 font-medium transition-colors",
                    active
                      ? "border-fg/30 bg-fg/[0.09] text-fg dark:border-white/25 dark:bg-white/[0.12]"
                      : "border-line/[0.07] bg-panel/80 text-muted hover:border-line/[0.16] hover:text-fg",
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: model.color }}
                  />
                  <span className="truncate">{model.label}</span>
                  <span className="shrink-0 tabular text-faint">
                    {formatMetricValue(model.tokens, model.cost, true)}
                  </span>
                </button>
              );
            })}

            {legendModels.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAllModels((v) => !v)}
                className="inline-flex h-7 items-center rounded-full px-2 text-11 font-medium text-muted hover:bg-line/[0.06] hover:text-fg"
              >
                {showAllModels ? "Show fewer" : `+${legendModels.length - 4} more`}
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {activeAgents.length > 1 && (
              <div className="inline-flex items-center gap-1 rounded-full border border-line/[0.08] bg-panel/70 p-0.5">
                <button
                  type="button"
                  aria-pressed={agentFilter === "all"}
                  onClick={() => setAgentFilter("all")}
                  className={cn(
                    "h-6 rounded-full px-2 text-11 font-medium transition-colors",
                    agentFilter === "all"
                      ? "bg-line/[0.1] text-fg"
                      : "text-faint hover:text-fg",
                  )}
                >
                  All
                </button>
                {activeAgents.map((agent) => {
                  const active = agentFilter === agent;
                  return (
                    <Tooltip key={agent} label={AGENTS[agent].name} side="top">
                      <button
                        type="button"
                        aria-label={`Filter by ${AGENTS[agent].name}`}
                        aria-pressed={active}
                        onClick={() =>
                          setAgentFilter((current) => (current === agent ? "all" : agent))
                        }
                        className={cn(
                          AGENT_CLASS[agent],
                          "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                          active
                            ? "bg-[var(--agent-soft)] text-[var(--agent-ink)] ring-1 ring-[var(--agent)]/40"
                            : "text-faint hover:bg-line/[0.06] hover:text-fg",
                        )}
                      >
                        <AgentMark agent={agent} className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}

            {canShowCost && (
              <Segmented
                value={displayedMetric}
                options={[
                  { value: "tokens", label: "Tokens" },
                  { value: "cost", label: "Est. cost" },
                ]}
                onChange={setMetric}
                compact
                className="bg-sunken/70 dark:bg-white/[0.05]"
              />
            )}
          </div>
        </div>

        {/* Main Calendar Canvas */}
        <div className="px-4 py-5 sm:px-6">
          {mode === "year" && (
            <YearHeatmapGrid
              yearMonths={yearMonths}
              index={index}
              todayKey={todayKey}
              selectedDay={selectedDay}
              selectedMonth={selectedMonth}
              displayedMetric={displayedMetric}
              intensityRef={intensityRef}
              scrollerRef={scrollerRef}
              monthRefs={monthRefs}
              onWheel={handleScrollerWheel}
              onSelectDay={handleSelectDay}
              onSelectMonth={handleSelectMonthBar}
              onHover={setHovered}
            />
          )}

          {mode === "month" && (
            <MonthCalendarGrid
              cells={monthCells}
              index={index}
              todayKey={todayKey}
              selectedDay={selectedDay}
              displayedMetric={displayedMetric}
              formatValue={formatMetricValue}
              onSelectDay={handleSelectDay}
              onHover={setHovered}
            />
          )}

          {mode === "week" && (
            <WeekColumnsView
              weekDays={weekDays}
              index={index}
              todayKey={todayKey}
              selectedDay={selectedDay}
              displayedMetric={displayedMetric}
              maxVal={maxWeekVal}
              formatValue={formatMetricValue}
              onSelectDay={handleSelectDay}
              onHover={setHovered}
            />
          )}
        </div>

        {/* Bottom Stacked Bar Strip ("By month" in Year mode, "By day" in Month mode) */}
        <div className="border-t border-line/[0.06] px-4 pb-4 pt-3.5 sm:px-6 sm:pb-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-12 font-semibold tracking-[-0.015em] text-fg/90">
              {mode === "year" ? "By month" : mode === "month" ? "By day" : "Week mix"}
            </span>
            <span className="text-12 font-medium tabular text-muted">{periodTotalLabel}</span>
          </div>

          {mode === "year" && (
            <div className="grid grid-cols-6 gap-1 sm:grid-cols-12 sm:gap-1.5">
              {monthlySummaries.map((item) => {
                const value = displayedMetric === "cost" ? item.cost : item.tokens;
                const barHeightPx =
                  value > 0 ? Math.max(4, Math.round((value / maxMonthVal) * 52)) : 0;
                const isHighlighted = highlightedMonthIndex === item.month;
                const isSelected = selectedMonth === item.month;
                return (
                  <button
                    key={item.month}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleSelectMonthBar(item.month)}
                    onMouseEnter={(e: ReactMouseEvent<HTMLButtonElement>) =>
                      setHovered({
                        kind: "month",
                        summary: item,
                        rect: e.currentTarget.getBoundingClientRect(),
                      })
                    }
                    onMouseLeave={() => setHovered(null)}
                    className={cn(
                      "group flex flex-col items-center rounded-[11px] px-1 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500",
                      isSelected
                        ? "bg-fg/[0.09] ring-1 ring-fg/20 dark:bg-white/[0.11] dark:ring-white/20"
                        : isHighlighted
                          ? "bg-line/[0.06] dark:bg-white/[0.065]"
                          : "hover:bg-line/[0.04] dark:hover:bg-white/[0.04]",
                    )}
                  >
                    {/* Bar well: value sits directly on top of the stacked bar */}
                    <div className="flex h-[70px] w-full flex-col items-center justify-end gap-1.5">
                      {value > 0 && (
                        <span
                          className={cn(
                            "text-[10.5px] leading-none tabular transition-colors",
                            isHighlighted || isSelected
                              ? "font-bold text-fg"
                              : "font-medium text-muted group-hover:text-fg",
                          )}
                        >
                          {formatMetricValue(item.tokens, item.cost, true)}
                        </span>
                      )}
                      {value > 0 ? (
                        <div
                          className="flex w-full max-w-[30px] flex-col-reverse overflow-hidden rounded-[4px] transition-all duration-200"
                          style={{ height: barHeightPx }}
                        >
                          {item.models.map((segment) => (
                            <span
                              key={segment.id}
                              style={{
                                height: `${Math.max(segment.share, 2)}%`,
                                backgroundColor: segment.color,
                              }}
                              className="block w-full shrink-0"
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="mb-[1px] h-[2px] w-4 rounded-full bg-line/[0.1]" />
                      )}
                    </div>
                    <span
                      className={cn(
                        "mt-1.5 text-11 leading-none",
                        isHighlighted || isSelected
                          ? "font-bold text-fg"
                          : "font-medium text-faint group-hover:text-muted",
                      )}
                    >
                      {item.shortLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {mode === "month" && (
            <div className="flex h-[72px] items-end gap-[3px] sm:gap-1">
              {monthDaysList.map(({ day, key, record }) => {
                const val = record
                  ? displayedMetric === "cost"
                    ? record.cost
                    : record.tokens
                  : 0;
                const heightPct =
                  val > 0 ? Math.max(8, Math.round((val / maxMonthDayVal) * 100)) : 0;
                const isSelected = selectedDay === key;
                const isToday = key === todayKey;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`${MONTH_SHORT[month]} ${day}: ${val > 0 ? formatMetricValue(record?.tokens ?? 0, record?.cost ?? 0) : "No usage"}`}
                    onClick={() => handleSelectDay(key)}
                    onMouseEnter={(e) =>
                      setHovered({
                        kind: "day",
                        key,
                        record,
                        rect: e.currentTarget.getBoundingClientRect(),
                      })
                    }
                    onMouseLeave={() => setHovered(null)}
                    className={cn(
                      "group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-[6px] py-0.5 transition-colors",
                      isSelected ? "bg-fg/[0.09] dark:bg-white/[0.11]" : "hover:bg-line/[0.04]",
                    )}
                  >
                    <div className="flex w-full flex-1 items-end justify-center px-[1px]">
                      {record && val > 0 ? (
                        <div
                          className="flex w-full max-w-[14px] flex-col-reverse overflow-hidden rounded-[3px]"
                          style={{ height: `${heightPct}%`, minHeight: 3 }}
                        >
                          {record.models.map((segment) => (
                            <span
                              key={segment.id}
                              style={{
                                height: `${Math.max(segment.share, 3)}%`,
                                backgroundColor: segment.color,
                              }}
                              className="block w-full"
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="h-[2px] w-full max-w-[10px] rounded-full bg-line/[0.08]" />
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-[9.5px] leading-none tabular",
                        isToday || isSelected
                          ? "font-bold text-fg"
                          : day === 1 || day % 5 === 0 || day === monthDaysList.length
                            ? "text-faint"
                            : "text-transparent group-hover:text-faint",
                      )}
                    >
                      {day}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {mode === "week" && (
            <div className="space-y-2">
              <div className="flex h-3 overflow-hidden rounded-full bg-line/[0.06]">
                {periodSummary.models.map((model) => (
                  <span
                    key={model.id}
                    style={{ width: `${model.share}%`, backgroundColor: model.color }}
                    className="h-full transition-all duration-200"
                    title={`${model.label}: ${pct(model.share, 1)}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-11 text-muted">
                <span>
                  {periodSummary.activeDays} active {periodSummary.activeDays === 1 ? "day" : "days"} ·{" "}
                  {number(periodSummary.sessionCount)} sessions
                </span>
                <span>
                  {periodSummary.models.length}{" "}
                  {periodSummary.models.length === 1 ? "model" : "models"} used
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Detailed Historical Records Inspector */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/[0.06] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-16 font-bold tracking-[-0.03em] text-fg">{inspection.title}</h2>
              {inspection.subtitle && (
                <span className="rounded-full bg-line/[0.06] px-2 py-0.5 text-11 font-medium text-muted">
                  {inspection.subtitle}
                </span>
              )}
              {selectedModelMeta && (
                <button
                  type="button"
                  onClick={() => setModelFilter(null)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line/[0.1] bg-sunken/70 px-2.5 py-0.5 text-11 font-medium text-fg transition-colors hover:bg-sunken"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: selectedModelMeta.color }}
                  />
                  {selectedModelMeta.label}
                  <X className="h-3 w-3 text-faint" />
                </button>
              )}
              {agentFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setAgentFilter("all")}
                  className="inline-flex items-center gap-1 rounded-full border border-line/[0.1] bg-sunken/70 px-2.5 py-0.5 text-11 font-medium text-fg transition-colors hover:bg-sunken"
                >
                  {AGENTS[agentFilter].shortName}
                  <X className="h-3 w-3 text-faint" />
                </button>
              )}
            </div>
            <p className="mt-0.5 text-12 text-muted">
              {inspection.summary.tokens > 0
                ? `${inspection.summary.models.length} ${inspection.summary.models.length === 1 ? "model" : "models"} across ${number(inspection.summary.sessionCount)} ${inspection.summary.sessionCount === 1 ? "session" : "sessions"}${inspection.kind !== "day" ? ` on ${number(inspection.summary.activeDays)} active ${inspection.summary.activeDays === 1 ? "day" : "days"}` : ""}`
                : "No token usage recorded for this selection."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {selectedDay && activePeriodDays.length > 1 && (
              <div className="inline-flex items-center rounded-full border border-line/[0.08] bg-sunken/55 p-0.5">
                <button
                  type="button"
                  aria-label="Previous active day"
                  disabled={activeDayPosition <= 0}
                  onClick={() => {
                    if (activeDayPosition > 0) setSelectedDay(activePeriodDays[activeDayPosition - 1]);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-line/[0.06] hover:text-fg disabled:opacity-30"
                >
                  <CaretLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-2 text-11 tabular text-faint">
                  {activeDayPosition >= 0 ? `${activeDayPosition + 1}/${activePeriodDays.length}` : "Day"}
                </span>
                <button
                  type="button"
                  aria-label="Next active day"
                  disabled={activeDayPosition < 0 || activeDayPosition >= activePeriodDays.length - 1}
                  onClick={() => {
                    if (activeDayPosition >= 0 && activeDayPosition < activePeriodDays.length - 1) {
                      setSelectedDay(activePeriodDays[activeDayPosition + 1]);
                    }
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-line/[0.06] hover:text-fg disabled:opacity-30"
                >
                  <CaretRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {mode === "year" && selectedMonth !== null && (
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-11"
                onClick={() => {
                  setMonth(selectedMonth);
                  setSelectedMonth(null);
                  setMode("month");
                }}
              >
                Open month view
                <ArrowRight className="h-3 w-3" />
              </Button>
            )}

            {(selectedDay !== null || selectedMonth !== null) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-11"
                icon={<X className="h-3 w-3" />}
                onClick={() => {
                  setSelectedDay(null);
                  setSelectedMonth(null);
                }}
              >
                Clear selection
              </Button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-2.5 border-b border-line/[0.06] bg-sunken/20 p-4 sm:grid-cols-4 sm:px-6 dark:bg-white/[0.015]">
          <KpiTile
            label="Total tokens"
            value={inspection.summary.tokens > 0 ? compact(inspection.summary.tokens) : "0"}
            meta={
              inspection.summary.tokens > 0
                ? `${compact(inspection.summary.input)} in · ${compact(inspection.summary.output)} out`
                : "No recorded usage"
            }
          />
          <KpiTile
            label={settings.showCosts ? "API-equivalent spend" : "Cache read share"}
            value={
              settings.showCosts
                ? inspection.summary.cost > 0
                  ? `${money(inspection.summary.cost)}${inspection.summary.costComplete ? "" : "*"}`
                  : "—"
                : inspection.summary.tokens > 0
                  ? pct((inspection.summary.cacheRead / inspection.summary.tokens) * 100, 1)
                  : "—"
            }
            meta={
              settings.showCosts
                ? inspection.summary.cost > 0
                  ? inspection.summary.costComplete
                    ? "Public list prices · not a bill"
                    : "Priced models only · not a bill"
                  : "No priced usage"
                : `${compact(inspection.summary.cacheRead)} cached tokens`
            }
          />
          <KpiTile
            label="Primary model"
            value={inspection.summary.models[0]?.label ?? "—"}
            colorDot={inspection.summary.models[0]?.color}
            meta={
              inspection.summary.models[0]
                ? `${pct(inspection.summary.models[0].share, 1)} share · ${inspection.summary.models.length} total`
                : "No models recorded"
            }
          />
          <KpiTile
            label={inspection.kind === "day" ? "Sessions" : "Daily pace"}
            value={
              inspection.kind === "day"
                ? number(inspection.summary.sessionCount)
                : inspection.summary.activeDays > 0
                  ? `${compact(inspection.summary.tokens / inspection.summary.activeDays)}/day`
                  : "—"
            }
            meta={
              inspection.kind === "day"
                ? `${compact(inspection.summary.cacheRead)} cache read`
                : `${number(inspection.summary.activeDays)} active ${inspection.summary.activeDays === 1 ? "day" : "days"} · best streak ${streaks.periodLongest}d`
            }
          />
        </div>

        {/* Models Used in Detail Table */}
        <div className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-13 font-bold tracking-[-0.02em] text-fg">
                Models used in detail
              </h3>
              <p className="text-11 text-muted">
                Click any model to isolate its days and monthly volume on the calendar above.
              </p>
            </div>
            {modelFilter && (
              <button
                type="button"
                onClick={() => setModelFilter(null)}
                className="inline-flex items-center gap-1 rounded-full bg-line/[0.06] px-2.5 py-1 text-11 font-medium text-muted hover:text-fg"
              >
                <FunnelSimple className="h-3 w-3" />
                Reset model filter
              </button>
            )}
          </div>

          {inspection.summary.models.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[620px]">
                <div className="grid grid-cols-[minmax(190px,1.4fr)_110px_68px_minmax(150px,1fr)_88px_76px] gap-3 border-b border-line/[0.06] px-3 pb-2 text-11 font-medium text-faint">
                  <span>Model</span>
                  <span>{inspection.kind === "day" ? "Agents" : "Active span"}</span>
                  <span className="text-right">Sessions</span>
                  <span className="text-right">Tokens (in / out / cache)</span>
                  <span className="text-right">Share</span>
                  <span className="text-right">{settings.showCosts ? "Est. cost" : "Cache"}</span>
                </div>

                <div className="divide-y divide-line/[0.045]">
                  {inspection.summary.models.map((model) => {
                    const isIsolated = modelFilter === model.id;
                    const cacheTotal = model.cacheRead + model.cacheWrite;
                    const cachePct = model.tokens > 0 ? (model.cacheRead / model.tokens) * 100 : 0;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        aria-pressed={isIsolated}
                        onClick={() =>
                          setModelFilter((current) => (current === model.id ? null : model.id))
                        }
                        className={cn(
                          "grid w-full grid-cols-[minmax(190px,1.4fr)_110px_68px_minmax(150px,1fr)_88px_76px] items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors",
                          isIsolated
                            ? "bg-fg/[0.065] dark:bg-white/[0.07]"
                            : "hover:bg-sunken/45",
                        )}
                      >
                        {/* Model identity + agents */}
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className="h-3 w-3 shrink-0 rounded-[4px]"
                            style={{ backgroundColor: model.color }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-12 font-semibold text-fg">
                                {model.label}
                              </span>
                              {isIsolated && (
                                <span className="shrink-0 rounded-full bg-fg/10 px-1.5 py-0.5 text-[10px] font-semibold text-fg">
                                  Filtered
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-11 text-faint">
                              <span className="truncate">{model.family}</span>
                              {inspection.kind !== "day" && model.agents.length > 0 && (
                                <>
                                  <span>·</span>
                                  <span className="inline-flex items-center gap-1">
                                    {model.agents.map((agent) => (
                                      <span
                                        key={agent}
                                        className={cn(AGENT_CLASS[agent], "text-[var(--agent)]")}
                                        title={AGENTS[agent].name}
                                      >
                                        <AgentMark agent={agent} className="h-3 w-3" />
                                      </span>
                                    ))}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Agents (day view) OR Active span (period view) */}
                        <div className="min-w-0">
                          {inspection.kind === "day" ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {model.agents.map((agent) => (
                                <span
                                  key={agent}
                                  className={cn(
                                    AGENT_CLASS[agent],
                                    "inline-flex items-center gap-1 rounded-full bg-[var(--agent-soft)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--agent-ink)]",
                                  )}
                                >
                                  <AgentMark agent={agent} className="h-2.5 w-2.5" />
                                  {AGENTS[agent].shortName}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-11">
                              <div className="font-medium tabular text-fg/85">
                                {model.activeDays} {model.activeDays === 1 ? "day" : "days"}
                              </div>
                              <div className="truncate text-faint">
                                {formatSpanDates(model.firstDay, model.lastDay)}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Sessions */}
                        <div className="text-right text-12 tabular text-muted">
                          {number(model.sessions)}
                        </div>

                        {/* Token breakdown */}
                        <div className="text-right">
                          <div className="text-12 font-semibold tabular text-fg/90">
                            {compact(model.tokens)}
                          </div>
                          <div className="text-[10.5px] tabular text-faint">
                            {compact(model.input)} in · {compact(model.output)} out
                            {cacheTotal > 0 ? ` · ${compact(cacheTotal)} cache` : ""}
                          </div>
                        </div>

                        {/* Share */}
                        <div className="flex items-center justify-end gap-2">
                          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-line/[0.07]">
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${model.share}%`, backgroundColor: model.color }}
                            />
                          </span>
                          <span className="w-9 text-right text-11 tabular text-muted">
                            {pct(model.share, 1)}
                          </span>
                        </div>

                        {/* Est. cost or cache % */}
                        <div className="text-right text-12 tabular text-muted">
                          {settings.showCosts
                            ? model.costKnown
                              ? money(model.cost)
                              : "—"
                            : pct(cachePct, 0)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center rounded-[16px] border border-dashed border-line/[0.1] bg-sunken/25 px-6 py-10 text-center">
              <CalendarBlank className="h-6 w-6 text-faint" />
              <div className="mt-2 text-13 font-semibold text-fg">No model activity recorded</div>
              <p className="mt-1 max-w-[42ch] text-12 text-muted">
                Try stepping to another period or clearing your active model or agent filter.
              </p>
            </div>
          )}

          {/* Model Usage Timeline (shown for Year/Month scopes with multiple models) */}
          {inspection.kind !== "day" && inspection.summary.models.length >= 2 && (
            <ModelSpanTimeline
              models={inspection.summary.models}
              from={inspection.summary.from}
              to={inspection.summary.to}
              activeModelId={modelFilter}
              onToggleModel={(id) =>
                setModelFilter((current) => (current === id ? null : id))
              }
            />
          )}
        </div>

        {/* Sessions Recorded in Selection */}
        {inspection.summary.sessions.length > 0 && (
          <div className="border-t border-line/[0.06] px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-13 font-bold tracking-[-0.02em] text-fg">
                {inspection.kind === "day"
                  ? `Sessions on ${parseDayKey(selectedDay!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : "Heaviest sessions in this record"}
              </h3>
              <span className="text-11 tabular text-faint">
                {number(inspection.summary.sessions.length)}{" "}
                {inspection.summary.sessions.length === 1 ? "session" : "sessions"}
              </span>
            </div>

            <div className="-mx-2 mt-2 space-y-0.5">
              {(showAllSessions
                ? inspection.summary.sessions
                : inspection.summary.sessions.slice(0, 8)
              ).map((entry) => (
                <button
                  key={entry.session.id}
                  type="button"
                  onClick={() => {
                    openSession(entry.session.id);
                    navigate("sessions");
                  }}
                  className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2 text-left transition-colors hover:bg-sunken/50"
                >
                  <span
                    className={cn(
                      AGENT_CLASS[entry.session.agent],
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--agent-soft)] text-[var(--agent-ink)]",
                    )}
                  >
                    <AgentMark agent={entry.session.agent} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-12 font-semibold text-fg/90">
                      {entry.session.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-11 text-faint">
                      <span className="truncate max-w-[160px]">{entry.session.projectRootLabel || entry.session.projectLabel}</span>
                      <span>·</span>
                      <span>{shortDate(entry.session.updatedAt)}</span>
                      {entry.models.slice(0, 3).map((modelId) => {
                        const meta = palette.get(modelId);
                        return (
                          <span
                            key={modelId}
                            className="inline-flex items-center gap-1 rounded-full bg-line/[0.055] px-1.5 py-0.5 text-[10.5px] font-medium text-muted"
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: meta?.color ?? "#8d8477" }}
                            />
                            {meta?.label ?? modelId}
                          </span>
                        );
                      })}
                      {entry.models.length > 3 && (
                        <span className="text-[10.5px] text-faint">
                          +{entry.models.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-12 font-semibold tabular text-fg/85">
                      {compact(entry.tokens)}
                    </div>
                    {settings.showCosts && (
                      <div className="text-11 tabular text-faint">
                        {entry.cost !== null ? money(entry.cost) : "—"}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {inspection.summary.sessions.length > 8 && (
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllSessions((v) => !v)}
                  className="rounded-full px-3 py-1 text-11 font-medium text-muted transition-colors hover:bg-line/[0.06] hover:text-fg"
                >
                  {showAllSessions
                    ? "Show fewer sessions"
                    : `Show all ${number(inspection.summary.sessions.length)} sessions`}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Rich Floating Hovercard (portaled to body so it never clips inside scroll areas) */}
      <CalendarHoverCard
        preview={hovered}
        showCosts={settings.showCosts}
        displayedMetric={displayedMetric}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Year Heatmap Grid (exact month-grouped ISO-week layout)             */
/* ------------------------------------------------------------------ */

function YearHeatmapGrid({
  yearMonths,
  index,
  todayKey,
  selectedDay,
  selectedMonth,
  displayedMetric,
  intensityRef,
  scrollerRef,
  monthRefs,
  onWheel,
  onSelectDay,
  onSelectMonth,
  onHover,
}: {
  yearMonths: ReturnType<typeof buildYearMonths>;
  index: Map<string, CalendarDayRecord>;
  todayKey: string;
  selectedDay: string | null;
  selectedMonth: number | null;
  displayedMetric: CalendarMetric;
  intensityRef: number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  monthRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onSelectDay: (key: string) => void;
  onSelectMonth: (month: number) => void;
  onHover: (preview: HoverPreview | null) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      {/* Sticky weekday labels (Mon–Fri plain, Sat/Sun pill-badged) */}
      <div className="shrink-0 select-none pr-1 pt-[30px]" aria-hidden="true">
        <div className="grid grid-rows-7 gap-[5px]">
          {WEEKDAY_LABELS.map((label, wd) => {
            const weekend = wd >= 5;
            return (
              <div key={label} className="flex h-[20px] items-center justify-end">
                <span
                  className={cn(
                    "text-11 leading-none",
                    weekend
                      ? "rounded-[5px] bg-line/[0.08] px-1.5 py-[3px] font-semibold text-fg/85 dark:bg-white/[0.11]"
                      : "pr-1 font-medium text-faint",
                  )}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Horizontally scrollable month columns */}
      <div className="relative min-w-0 flex-1">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-4 bg-gradient-to-r from-panel to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-20 w-4 bg-gradient-to-l from-panel to-transparent"
        />
        <div
          ref={scrollerRef}
          onWheel={onWheel}
          role="region"
          aria-label="Yearly model activity heatmap"
          tabIndex={0}
          className="overflow-x-auto pb-2"
        >
        <div className="inline-flex items-start px-1.5">
          {yearMonths.map((monthBlock) => {
            const isSelectedMonth = selectedMonth === monthBlock.month;
            return (
              <div
                key={monthBlock.month}
                ref={(el) => {
                  monthRefs.current[monthBlock.month] = el;
                }}
                className={cn(
                  "shrink-0 border-r border-line/[0.07] px-3 first:pl-1.5 last:border-r-0",
                  isSelectedMonth && "rounded-[12px] bg-line/[0.03] dark:bg-white/[0.025]",
                )}
              >
                {/* Centered month name */}
                <div className="mb-2.5 flex h-[20px] items-center justify-center">
                  <button
                    type="button"
                    onClick={() => onSelectMonth(monthBlock.month)}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-12 transition-colors",
                      isSelectedMonth
                        ? "bg-fg/[0.09] font-bold text-fg dark:bg-white/[0.12]"
                        : "font-medium text-muted hover:text-fg",
                    )}
                  >
                    {monthBlock.name}
                  </button>
                </div>

                {/* Week columns with subtle Sat/Sun weekend band */}
                <div className="relative">
                  {/* Weekend shading strip behind rows 5 & 6 (Sat & Sun) */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-[-4px] bottom-[-3px] h-[51px] rounded-[7px] bg-line/[0.04] dark:bg-white/[0.035]"
                  />

                  <div className="relative flex gap-[5px]">
                    {monthBlock.weeks.map((week, weekIdx) => (
                      <div key={weekIdx} className="grid grid-rows-7 gap-[5px]">
                        {week.map((dayKey, wd) => {
                          if (!dayKey) {
                            return <span key={wd} className="h-[20px] w-[20px]" aria-hidden="true" />;
                          }
                          const record = index.get(dayKey) ?? null;
                          const isFuture = dayKey > todayKey;
                          const isToday = dayKey === todayKey;
                          const isSelected = selectedDay === dayKey;
                          const dayValue = record
                            ? displayedMetric === "cost"
                              ? record.cost
                              : record.tokens
                            : 0;
                          const active = record !== null && dayValue > 0;
                          const bg = active ? dayCellBackground(record.models) : undefined;
                          const opacity = active ? dayIntensity(dayValue, intensityRef) : 1;

                          const accessibleLabel = active
                            ? `${parseDayKey(dayKey).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}: ${compact(record.tokens)} tokens across ${record.models.map((m) => m.label).join(", ")}`
                            : `${parseDayKey(dayKey).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}: No usage`;

                          return (
                            <button
                              key={dayKey}
                              type="button"
                              aria-label={accessibleLabel}
                              aria-pressed={isSelected}
                              onClick={() => onSelectDay(dayKey)}
                              onMouseEnter={(e) =>
                                onHover({
                                  kind: "day",
                                  key: dayKey,
                                  record,
                                  rect: e.currentTarget.getBoundingClientRect(),
                                })
                              }
                              onMouseLeave={() => onHover(null)}
                              onFocus={(e) =>
                                onHover({
                                  kind: "day",
                                  key: dayKey,
                                  record,
                                  rect: e.currentTarget.getBoundingClientRect(),
                                })
                              }
                              onBlur={() => onHover(null)}
                              className={cn(
                                "relative flex h-[20px] w-[20px] items-center justify-center rounded-[5px] transition-transform duration-100 hover:z-10 hover:scale-[1.12] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-copper-500",
                                !active &&
                                  (isFuture
                                    ? "border border-line/[0.1] bg-transparent opacity-45 dark:border-white/[0.1]"
                                    : "border border-line/[0.18] bg-transparent hover:border-line/40 dark:border-white/[0.18] dark:hover:border-white/40"),
                                isToday &&
                                  "z-10 ring-[2px] ring-fg dark:ring-white shadow-[0_0_0_1px_rgba(0,0,0,0.2)]",
                                isSelected &&
                                  !isToday &&
                                  "z-10 ring-[2px] ring-fg/90 ring-offset-1 ring-offset-panel dark:ring-white",
                              )}
                            >
                              {active && bg && (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-0 rounded-[5px]"
                                  style={{ background: bg, opacity }}
                                />
                              )}
                              {isToday && (
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    "relative z-10 h-[5px] w-[5px] rounded-full",
                                    active
                                      ? "bg-white shadow-[0_0_2px_rgba(0,0,0,0.45)]"
                                      : "bg-fg dark:bg-white",
                                  )}
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Month Calendar Grid                                                 */
/* ------------------------------------------------------------------ */

function MonthCalendarGrid({
  cells,
  index,
  todayKey,
  selectedDay,
  displayedMetric,
  formatValue,
  onSelectDay,
  onHover,
}: {
  cells: ReturnType<typeof buildMonthMatrix>;
  index: Map<string, CalendarDayRecord>;
  todayKey: string;
  selectedDay: string | null;
  displayedMetric: CalendarMetric;
  formatValue: (tokens: number, cost: number, short?: boolean) => string;
  onSelectDay: (key: string) => void;
  onHover: (preview: HoverPreview | null) => void;
}) {
  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAY_LABELS.map((label, wd) => (
          <div key={label} className="flex justify-center">
            <span
              className={cn(
                "text-11",
                wd >= 5
                  ? "rounded-[5px] bg-line/[0.075] px-2 py-0.5 font-semibold text-fg/85 dark:bg-white/[0.1]"
                  : "py-0.5 font-medium text-faint",
              )}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell) => {
          const record = index.get(cell.key) ?? null;
          const isToday = cell.key === todayKey;
          const isSelected = selectedDay === cell.key;
          const isFuture = cell.key > todayKey;
          const active = record !== null && record.tokens > 0;
          const topModel = record?.models[0];

          return (
            <button
              key={cell.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelectDay(cell.key)}
              onMouseEnter={(e) =>
                onHover({
                  kind: "day",
                  key: cell.key,
                  record,
                  rect: e.currentTarget.getBoundingClientRect(),
                })
              }
              onMouseLeave={() => onHover(null)}
              className={cn(
                "flex min-h-[76px] flex-col justify-between rounded-[12px] border p-2 text-left transition-colors sm:min-h-[84px] sm:p-2.5",
                !cell.inMonth && "opacity-35",
                cell.weekday >= 5
                  ? "bg-line/[0.03] dark:bg-white/[0.025]"
                  : "bg-panel",
                isSelected
                  ? "border-fg/40 bg-fg/[0.05] ring-1 ring-fg/20 dark:border-white/40 dark:bg-white/[0.07]"
                  : isToday
                    ? "border-copper-500/60 dark:border-copper-400/60"
                    : "border-line/[0.07] hover:border-line/[0.18]",
                isFuture && !active && "opacity-45",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-11 tabular",
                    isToday
                      ? "bg-fg font-bold text-canvas"
                      : active
                        ? "font-semibold text-fg"
                        : "font-medium text-faint",
                  )}
                >
                  {cell.dayOfMonth}
                </span>
                {active && record && (
                  <span className="truncate text-[10.5px] font-semibold tabular text-fg/85">
                    {formatValue(record.tokens, record.cost, true)}
                  </span>
                )}
              </div>

              {active && record ? (
                <div className="mt-2 space-y-1.5">
                  <div className="flex h-2 overflow-hidden rounded-full bg-line/[0.07]">
                    {record.models.map((m) => (
                      <span
                        key={m.id}
                        style={{ width: `${Math.max(m.share, 5)}%`, backgroundColor: m.color }}
                        className="h-full"
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-[10.5px] text-muted">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: topModel?.color }}
                    />
                    <span className="min-w-0 truncate">{topModel?.label}</span>
                    {record.models.length > 1 && (
                      <span className="shrink-0 font-medium text-faint">
                        +{record.models.length - 1}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-2" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week Columns View                                                   */
/* ------------------------------------------------------------------ */

function WeekColumnsView({
  weekDays,
  index,
  todayKey,
  selectedDay,
  displayedMetric,
  maxVal,
  formatValue,
  onSelectDay,
  onHover,
}: {
  weekDays: string[];
  index: Map<string, CalendarDayRecord>;
  todayKey: string;
  selectedDay: string | null;
  displayedMetric: CalendarMetric;
  maxVal: number;
  formatValue: (tokens: number, cost: number, short?: boolean) => string;
  onSelectDay: (key: string) => void;
  onHover: (preview: HoverPreview | null) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-2 sm:gap-3">
      {weekDays.map((key, wd) => {
        const parsed = parseDayKey(key);
        const record = index.get(key) ?? null;
        const val = record ? (displayedMetric === "cost" ? record.cost : record.tokens) : 0;
        const isToday = key === todayKey;
        const isSelected = selectedDay === key;
        const weekend = wd >= 5;

        return (
          <button
            key={key}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelectDay(key)}
            onMouseEnter={(e) =>
              onHover({
                kind: "day",
                key,
                record,
                rect: e.currentTarget.getBoundingClientRect(),
              })
            }
            onMouseLeave={() => onHover(null)}
            className={cn(
              "flex flex-col items-center rounded-[14px] border px-2 py-3 text-center transition-colors",
              weekend ? "bg-line/[0.03] dark:bg-white/[0.025]" : "bg-panel",
              isSelected
                ? "border-fg/40 bg-fg/[0.05] dark:border-white/35 dark:bg-white/[0.07]"
                : isToday
                  ? "border-copper-500/50"
                  : "border-line/[0.07] hover:border-line/[0.18]",
            )}
          >
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "text-11",
                  weekend
                    ? "rounded-[4px] bg-line/[0.08] px-1.5 py-0.5 font-semibold text-fg/85 dark:bg-white/[0.1]"
                    : "font-medium text-faint",
                )}
              >
                {WEEKDAY_LABELS[wd]}
              </span>
              <span
                className={cn(
                  "text-11 tabular",
                  isToday ? "font-bold text-copper-500 dark:text-copper-300" : "text-muted",
                )}
              >
                {parsed.getDate()}
              </span>
            </div>

            {/* Tall stacked vertical bar */}
            <div className="mt-3 flex h-[126px] w-full flex-col items-center justify-end gap-1.5">
              <span
                className={cn(
                  "text-11 leading-none tabular",
                  val > 0 ? "font-bold text-fg" : "text-faint/50",
                )}
              >
                {val > 0 ? formatValue(record?.tokens ?? 0, record?.cost ?? 0, true) : "—"}
              </span>
              {record && val > 0 ? (
                <div
                  className="flex w-full max-w-[38px] flex-col-reverse overflow-hidden rounded-[6px] transition-all duration-200"
                  style={{ height: Math.max(6, Math.round((val / maxVal) * 98)) }}
                >
                  {record.models.map((segment) => (
                    <span
                      key={segment.id}
                      style={{
                        height: `${Math.max(segment.share, 3)}%`,
                        backgroundColor: segment.color,
                      }}
                      className="block w-full"
                    />
                  ))}
                </div>
              ) : (
                <span className="mb-[1px] h-[3px] w-6 rounded-full bg-line/[0.09]" />
              )}
            </div>

            <div className="mt-2.5 flex min-h-[18px] items-center justify-center gap-1">
              {record && record.models.length > 0 ? (
                <>
                  {record.models.slice(0, 3).map((m) => (
                    <span
                      key={m.id}
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: m.color }}
                      title={m.label}
                    />
                  ))}
                  {record.models.length > 3 && (
                    <span className="text-[10px] text-faint">+{record.models.length - 3}</span>
                  )}
                </>
              ) : (
                <span className="text-[10.5px] text-faint/60">Rest</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Model Span Timeline (when each model was used across the period)    */
/* ------------------------------------------------------------------ */

function ModelSpanTimeline({
  models,
  from,
  to,
  activeModelId,
  onToggleModel,
}: {
  models: ModelBucket[];
  from: string;
  to: string;
  activeModelId: string | null;
  onToggleModel: (id: string) => void;
}) {
  const startMs = parseDayKey(from).getTime();
  const endMs = parseDayKey(to).getTime();
  const spanMs = Math.max(86_400_000, endMs - startMs);
  const topModels = models.slice(0, 8);

  return (
    <div className="mt-5 rounded-[16px] border border-line/[0.06] bg-sunken/30 p-4 dark:bg-white/[0.02]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-12 font-semibold text-fg">
          <Sparkle className="h-3.5 w-3.5 text-copper-500 dark:text-copper-300" />
          Model usage timeline
        </div>
        <span className="text-11 text-faint">
          {formatSpanDates(from, to)}
        </span>
      </div>

      <div className="space-y-2">
        {topModels.map((model) => {
          const left = Math.max(
            0,
            Math.min(98, ((parseDayKey(model.firstDay).getTime() - startMs) / spanMs) * 100),
          );
          const right = Math.max(
            left + 2,
            Math.min(100, ((parseDayKey(model.lastDay).getTime() - startMs) / spanMs) * 100),
          );
          const width = Math.max(2.5, right - left);
          const active = activeModelId === model.id;
          return (
            <button
              key={model.id}
              type="button"
              onClick={() => onToggleModel(model.id)}
              className={cn(
                "grid w-full grid-cols-[140px_minmax(0,1fr)_92px] items-center gap-3 rounded-[8px] px-2 py-1 text-left transition-colors sm:grid-cols-[170px_minmax(0,1fr)_110px]",
                active ? "bg-fg/[0.07] dark:bg-white/[0.08]" : "hover:bg-line/[0.04]",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-11">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: model.color }}
                />
                <span className="truncate font-medium text-fg/85">{model.label}</span>
              </span>
              <span className="relative block h-2.5 rounded-full bg-line/[0.06]">
                <span
                  className="absolute top-0 bottom-0 rounded-full transition-all"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: model.color,
                    opacity: activeModelId && !active ? 0.35 : 0.9,
                  }}
                />
              </span>
              <span className="truncate text-right text-[10.5px] tabular text-faint">
                {formatSpanDates(model.firstDay, model.lastDay)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Floating Hovercard                                                  */
/* ------------------------------------------------------------------ */

function CalendarHoverCard({
  preview,
  showCosts,
  displayedMetric,
}: {
  preview: HoverPreview | null;
  showCosts: boolean;
  displayedMetric: CalendarMetric;
}) {
  if (typeof document === "undefined" || !preview) return null;

  const vw = document.documentElement.clientWidth;
  const width = 236;
  const centerX = preview.rect.left + preview.rect.width / 2;
  const left = Math.max(10, Math.min(vw - width - 10, centerX - width / 2));
  const placeBelow = preview.rect.top < 175;
  const top = placeBelow ? preview.rect.bottom + 8 : preview.rect.top - 8;

  const isDay = preview.kind === "day";
  const models = isDay ? preview.record?.models ?? [] : preview.summary.models;
  const tokens = isDay ? preview.record?.tokens ?? 0 : preview.summary.tokens;
  const cost = isDay ? preview.record?.cost ?? 0 : preview.summary.cost;
  const sessionCount = isDay ? preview.record?.sessionCount ?? 0 : preview.summary.sessionCount;

  const title = isDay
    ? parseDayKey(preview.key).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : `${preview.summary.longLabel} ${preview.summary.year}`;

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[130] w-[236px] rounded-[14px] border border-white/10 bg-[#23211e] px-3 py-2.5 text-paper-50 shadow-float"
      style={{
        left,
        top,
        transform: placeBelow ? "none" : "translateY(-100%)",
      }}
    >
      <div className="flex items-center justify-between gap-2 text-11 font-medium text-white/50">
        <span>{title}</span>
        {sessionCount > 0 && (
          <span className="tabular">{number(sessionCount)} {sessionCount === 1 ? "session" : "sessions"}</span>
        )}
      </div>

      {tokens > 0 ? (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-16 font-bold leading-none tabular tracking-[-0.03em] text-white">
              {displayedMetric === "cost" && showCosts && cost > 0
                ? money(cost)
                : `${compact(tokens)} tokens`}
            </span>
            {showCosts && cost > 0 && displayedMetric === "tokens" && (
              <span className="text-11 tabular text-white/55">≈ {money(cost)}</span>
            )}
            {displayedMetric === "cost" && (
              <span className="text-11 tabular text-white/55">{compact(tokens)}</span>
            )}
          </div>

          <div className="mt-2 space-y-1 border-t border-white/[0.08] pt-2">
            {models.slice(0, 4).map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-11">
                <span
                  className="h-2 w-2 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: m.color }}
                />
                <span className="min-w-0 flex-1 truncate text-white/90">{m.label}</span>
                <span className="shrink-0 tabular text-white/60">
                  {displayedMetric === "cost" && m.costKnown ? money(m.cost) : compactShort(m.tokens)}
                </span>
                <span className="w-8 shrink-0 text-right tabular text-white/40">
                  {pct(m.share, 0)}
                </span>
              </div>
            ))}
            {models.length > 4 && (
              <div className="text-[10.5px] text-white/40">+{models.length - 4} more models</div>
            )}
          </div>
          <div className="mt-1.5 text-[10px] text-white/35">
            {isDay ? "Click to inspect day in detail" : "Click to inspect month"}
          </div>
        </>
      ) : (
        <div className="mt-1 text-12 text-white/55">No recorded model usage</div>
      )}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function KpiTile({
  label,
  value,
  meta,
  colorDot,
}: {
  label: string;
  value: string;
  meta: string;
  colorDot?: string;
}) {
  return (
    <div className="min-w-0 rounded-[14px] border border-line/[0.06] bg-panel px-3.5 py-3">
      <div className="text-11 font-medium text-faint">{label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        {colorDot && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: colorDot }}
          />
        )}
        <span className="truncate text-16 font-black tabular tracking-[-0.03em] text-fg">
          {value}
        </span>
      </div>
      <div className="mt-0.5 truncate text-11 text-muted">{meta}</div>
    </div>
  );
}

function formatSpanDates(from: string, to: string): string {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  const sameYear = a.getFullYear() === b.getFullYear();
  if (from === to) {
    return `${MONTH_SHORT[a.getMonth()]} ${a.getDate()}`;
  }
  if (sameYear) {
    return `${MONTH_SHORT[a.getMonth()]} ${a.getDate()} – ${MONTH_SHORT[b.getMonth()]} ${b.getDate()}`;
  }
  return `${MONTH_SHORT[a.getMonth()]} '${String(a.getFullYear()).slice(-2)} – ${MONTH_SHORT[b.getMonth()]} '${String(b.getFullYear()).slice(-2)}`;
}
