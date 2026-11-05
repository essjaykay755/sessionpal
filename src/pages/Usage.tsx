import { useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChartLineUp,
  Coins,
  Database,
  Info,
} from "@phosphor-icons/react";
import { AGENT_CLASS, AGENTS, AGENT_ORDER, TINT_CLASS } from "../lib/agents";
import {
  agentStats,
  dailyUsage,
  filterRange,
  modelStats,
  overlapsWindow,
  RANGE_LABELS,
  RANGE_SHORT,
  rangeWindow,
  sessionUsageParts,
  undatedUsageSessions,
  usageInWindow,
  usageTotals,
} from "../lib/analytics";
import { usageTokens } from "../lib/pricing";
import { useApp } from "../lib/store";
import type { RangeKey, Tint } from "../lib/types";
import {
  bytes,
  cn,
  compact,
  money,
  number,
  pct,
  relativeTime,
} from "../lib/utils";
import { AgentMark } from "../components/Brand";
import { AreaChart } from "../components/charts";
import { PageHeader, PageScroll, SectionTitle } from "../components/PageChrome";
import { AgentBadge, AnimatedNumber, Button, EstimatedTag, Segmented } from "../components/ui";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = (
  ["7d", "30d", "90d", "1y"] as RangeKey[]
).map((value) => ({ value, label: RANGE_SHORT[value] }));

export default function UsagePage() {
  const { sessions, settings, openDialog, updateSettings, focusAgent, effectiveTheme, navigate } =
    useApp();
  const [range, setRange] = useState<RangeKey>("30d");
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");

  const span = useMemo(() => rangeWindow(range), [range]);
  const ranged = useMemo(() => filterRange(sessions, range), [sessions, range]);
  const totals = useMemo(() => usageTotals(ranged, span), [ranged, span]);
  const hasUnpricedUsage = totals.pricedSessions < totals.sessionsWithUsage;
  const hasIncompleteSavings = totals.savingsSessions < totals.sessionsWithUsage;
  const hasPricedSessions = totals.pricedSessions > 0;
  const displayedMetric = hasPricedSessions ? metric : "tokens";
  const previousWindow = useMemo(() => rangeWindow(range, Date.now(), 1), [range]);
  const previous = useMemo(
    () => sessions.filter((session) => overlapsWindow(session, previousWindow)),
    [sessions, previousWindow],
  );
  const previousTotals = useMemo(() => usageTotals(previous, previousWindow), [previous, previousWindow]);
  const previousHasUnpricedUsage = previousTotals.pricedSessions < previousTotals.sessionsWithUsage;
  const daily = useMemo(() => dailyUsage(sessions, range), [sessions, range]);
  const undated = useMemo(() => undatedUsageSessions(ranged), [ranged]);
  const agents = useMemo(() => agentStats(ranged, span), [ranged, span]);
  const models = useMemo(() => modelStats(ranged, span), [ranged, span]);
  const parts = useMemo(() => sessionUsageParts(ranged, span), [ranged, span]);
  const projects = useMemo(() => {
    const map = new Map<string, { label: string; sessions: number; tokens: number }>();
    for (const session of ranged) {
      const tokens = usageTokens(usageInWindow(session, span));
      const current = map.get(session.project);
      if (current) {
        current.sessions += 1;
        current.tokens += tokens;
      } else {
        map.set(session.project, {
          label: session.projectLabel,
          sessions: 1,
          tokens,
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5);
  }, [ranged, span]);

  const chartColor =
    displayedMetric === "cost"
      ? effectiveTheme === "dark"
        ? "#d39a76"
        : "#b8693f"
      : effectiveTheme === "dark"
        ? "#9cbcc1"
        : "#547983";

  const tokenDelta = percentChange(totals.tokens, previousTotals.tokens);
  const costDelta = percentChange(totals.cost, previousTotals.cost);
  const sessionsDelta = percentChange(totals.sessions, previousTotals.sessions);
  const cacheShare = totals.tokens ? (totals.cacheRead / totals.tokens) * 100 : 0;
  const tokenTotal = parts.reduce((sum, part) => sum + part.value, 0) || 1;

  return (
    <PageScroll>
      <PageHeader
        title="Usage & cost"
        subtitle="Estimated from local session metadata at public API prices."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Info className="h-3.5 w-3.5" />}
              className="hidden sm:inline-flex"
              onClick={() => openDialog({ kind: "explain-costs" })}
            >
              How estimates work
            </Button>
            <Segmented
              value={range}
              options={RANGE_OPTIONS}
              onChange={setRange}
              className="bg-line/[0.055]"
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Tokens processed"
          value={<AnimatedNumber value={totals.tokens} format={compact} />}
          meta={
            totals.cacheRead > 0
              ? `${compact(totals.input + totals.output)} input + output · ${compact(totals.cacheRead + totals.cacheWrite)} cache`
              : `${number(totals.sessions)} sessions in ${RANGE_LABELS[range].toLowerCase()}`
          }
          icon={<ChartLineUp className="h-4 w-4" />}
          delta={tokenDelta}
          tint="sky"
        />
        <StatCard
          label="Estimated API value"
          value={settings.showCosts ? (hasPricedSessions ? <AnimatedNumber value={totals.cost} format={(value) => money(value)} /> : "Unavailable") : "Hidden"}
          meta={settings.showCosts ? (hasUnpricedUsage ? `${totals.pricedSessions} of ${totals.sessionsWithUsage} sessions priced` : "Standard API rates") : "Tap to show estimates"}
          icon={<Coins className="h-4 w-4" />}
          delta={settings.showCosts && !hasUnpricedUsage && !previousHasUnpricedUsage ? costDelta : null}
          tint="peach"
          onClick={!settings.showCosts ? () => updateSettings({ showCosts: true }) : undefined}
        />
        <StatCard
          label="Est. cache savings"
          value={
            settings.showCosts && totals.savingsSessions > 0 ? (
              <AnimatedNumber value={totals.cacheSavings} format={(value) => money(value)} />
            ) : (
              settings.showCosts ? "Unavailable" : "Hidden"
            )
          }
          meta={hasIncompleteSavings ? `${totals.savingsSessions} of ${totals.sessionsWithUsage} sessions priced` : `${pct(cacheShare, 0)} of tokens reused`}
          icon={<Coins className="h-4 w-4" />}
          delta={null}
          tint="sage"
        />
        <StatCard
          label="Sessions"
          value={<AnimatedNumber value={totals.sessions} format={number} />}
          meta={`${totals.sessionsWithUsage} include token data`}
          icon={<Database className="h-4 w-4" />}
          delta={sessionsDelta}
          tint="butter"
        />
      </div>

      <section className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <div className="card min-w-0 overflow-hidden p-4 sm:p-6 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-13 font-bold tracking-[-0.02em] text-fg">
                  {displayedMetric === "tokens" ? "Token consumption" : "Estimated spend"}
                </h2>
                <span className="text-11 text-faint">· {RANGE_LABELS[range]}</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2.5">
                <span className="text-32 font-black leading-none tracking-[-0.05em] text-fg">
                  {displayedMetric === "tokens" ? compact(totals.tokens) : money(totals.cost)}
                </span>
                <span className="text-11 text-muted">
                  {displayedMetric === "tokens" ? "tokens across all sessions" : hasUnpricedUsage ? "priced sessions only" : "API-equivalent, not billed"}
                </span>
              </div>
            </div>
            <Segmented
              value={displayedMetric}
              options={[
                { value: "tokens", label: "Tokens" },
                ...(hasPricedSessions ? [{ value: "cost" as const, label: "Est. cost" }] : []),
              ]}
              onChange={setMetric}
              compact
              className="bg-sunken/60"
            />
          </div>

          <div className="mt-2">
            <AreaChart
              data={daily}
              getValue={(point) => (displayedMetric === "tokens" ? point.tokens : point.cost)}
              getDate={(point) => point.date}
              formatValue={(value) => (displayedMetric === "tokens" ? compact(value) : `$${value.toFixed(0)}`)}
              color={chartColor}
              height={160}
              showAxis
              animationKey={`${range}-${metric}`}
              tooltip={(point) => (
                <div className="min-w-[130px]">
                  <div className="text-11 font-medium text-white/45">
                    {point.date.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  <div className="mt-1 text-16 font-bold leading-none tracking-[-0.03em]">
                    {compact(point.tokens)} tokens
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-11 text-white/45">
                    <span>{number(point.sessions)} sessions</span>
                    {hasPricedSessions && <span>≈ {money(point.cost)}{hasUnpricedUsage ? "*" : ""}</span>}
                  </div>
                </div>
              )}
            />
            {undated > 0 && (
              <p className="mt-2 text-11 text-faint">
                {number(undated)} {undated === 1 ? "session stores" : "sessions store"} only
                session totals, so {undated === 1 ? "its" : "their"} usage is shown on the
                day {undated === 1 ? "it was" : "they were"} last active.
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line/[0.06] pt-3">
            <div className="flex items-center gap-4 text-11 text-faint">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: chartColor }} />
                {displayedMetric === "tokens" ? "Input + output + cache read + write" : "Estimated from list prices"}
              </span>
              <span>{number(totals.sessions)} sessions</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-11"
              icon={<Info className="h-3 w-3" />}
              onClick={() => openDialog({ kind: "explain-costs" })}
            >
              Estimate details
            </Button>
          </div>
        </div>

        <div className="card min-w-0 p-5 lg:col-span-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-14 font-semibold text-fg">Sessions by agent</h2>
            <span className="text-12 text-muted">{number(totals.sessions)} total</span>
          </div>
          <div className="mt-4 space-y-3">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => focusAgent(agent.id)}
                className="group block w-full rounded-[8px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500"
              >
                <span className="flex items-center gap-2 text-12">
                  <span className={`${AGENT_CLASS[agent.id]} text-[var(--agent)]`}>
                    <AgentMark agent={agent.id} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-fg/85 group-hover:text-fg">{AGENTS[agent.id].shortName}</span>
                  <span className="tabular text-muted">{number(agent.sessions)}</span>
                  <span className="w-11 text-right tabular text-faint">{pct(agent.share, 0)}</span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line/[0.06]">
                  <span className={cn("block h-full rounded-full bg-[var(--agent)]", AGENT_CLASS[agent.id])} style={{ width: `${agent.share}%` }} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <div className="card overflow-hidden lg:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 sm:px-6">
            <div>
              <h2 className="text-16 font-bold tracking-[-0.03em]">Models in use</h2>
              <p className="mt-1 text-11 text-muted">
                {models.length} models across {number(totals.sessions)} sessions
              </p>
            </div>
            <span className="pb-0.5 text-11 text-faint">
              {settings.showCosts ? "Estimated at public list prices" : "Cost estimates hidden"}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_52px_68px_72px] gap-2 border-b border-line/[0.06] px-5 pb-2 text-11 font-medium text-faint sm:grid-cols-[minmax(0,1fr)_56px_60px_84px_68px] sm:px-6">
            <span>Model</span>
            <span className="text-right">Sessions</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Share</span>
            <span className="hidden text-right sm:block">
              {settings.showCosts ? "Est. cost" : "Cost"}
            </span>
          </div>
          <div className="px-2 pb-2 pt-1 sm:px-2.5">
            {models.map((model, index) => (
              <motion.div
                key={model.id}
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.12 }}
                className="grid grid-cols-[minmax(0,1fr)_52px_68px_72px] items-center gap-2 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-sunken/40 sm:grid-cols-[minmax(0,1fr)_56px_60px_84px_68px]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: model.color }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-12 font-semibold text-fg/90">{model.label}</div>
                    <div className="text-11 text-faint">{model.family}</div>
                  </div>
                </div>
                <div className="text-right text-11 tabular text-muted">
                  {number(model.sessions)}
                </div>
                <div className="text-right text-11 tabular text-muted">
                  {compact(model.tokens)}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="hidden h-1.5 w-9 overflow-hidden rounded-full bg-line/[0.06] sm:block">
                    <motion.span
                      initial={false}
                      animate={{ width: `${model.share}%` }}
                      transition={{ duration: 0.12 }}
                      className="block h-full rounded-full"
                      style={{ backgroundColor: model.color }}
                    />
                  </span>
                  <span className="w-8 text-right text-11 tabular text-faint">
                    {pct(model.share, 1)}
                  </span>
                </div>
                <div className="hidden text-right text-11 tabular text-muted sm:block">
                  {settings.showCosts && model.costKnown ? money(model.cost) : "—"}
                </div>
              </motion.div>
            ))}
            {models.length === 0 && (
              <div className="px-4 py-8 text-center text-12 text-muted">
                No token usage recorded in this range.
              </div>
            )}
          </div>
          {models.length > 0 && (
            <div className="flex items-center gap-2 border-t border-line/[0.06] px-5 py-3 text-11 text-faint sm:px-6">
              <EstimatedTag />
              <span>
                Model usage is grouped by session; sessions using multiple models are shown together. Dates reflect each session’s last update. {hasUnpricedUsage ? "Cost totals exclude unpriced or mixed-model sessions." : "Costs are API-equivalent estimates, not a subscription bill."}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3.5 lg:col-span-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-14 font-bold tracking-[-0.025em]">Token composition</h2>
              <span className="text-11 text-faint">{compact(totals.tokens)}</span>
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-line/[0.055]">
              {parts.map((part) => (
                <motion.span
                  key={part.label}
                  initial={false}
                  animate={{ width: `${(part.value / tokenTotal) * 100}%` }}
                  transition={{ duration: 0.12 }}
                  style={{ backgroundColor: part.color }}
                  title={`${part.label}: ${number(part.value)}`}
                />
              ))}
            </div>
            <div className="mt-4 space-y-2.5">
              {parts.map((part) => (
                <div key={part.label} className="flex items-center gap-2.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: part.color }}
                  />
                  <span className="flex-1 text-11 text-muted">{part.label}</span>
                  <span className="text-11 font-medium tabular text-fg/85">
                    {compact(part.value)}
                  </span>
                  <span className="w-10 text-right text-11 tabular text-faint">
                    {pct((part.value / tokenTotal) * 100, 1)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-[11px] bg-sunken/50 px-3 py-2.5 text-11 leading-relaxed text-muted">
              {pct(cacheShare, 0)} of tokens were cache reads. That reuse
              {settings.showCosts && totals.savingsSessions > 0 ? ` saved about ${money(totals.cacheSavings)} in cache-read costs${hasIncompleteSavings ? " for priced sessions" : ""}.` : "."}
            </div>
          </div>

          <div className="card flex-1 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-14 font-bold tracking-[-0.025em]">Top projects</h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-11"
                onClick={() => navigate("sessions")}
              >
                All sessions
                <ArrowRight className="h-2.5 w-2.5" />
              </Button>
            </div>
            <div className="mt-3 space-y-2.5">
              {projects.map((project, index) => (
                <div key={project.label} className="flex items-center gap-2.5">
                  <span className="w-3 text-11 tabular text-faint">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-11 font-medium text-fg/85">
                        {project.label}
                      </span>
                      <span className="shrink-0 text-11 tabular text-faint">
                        {compact(project.tokens)}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-line/[0.055]">
                      <motion.span
                        initial={false}
                        animate={{
                          width: `${projects[0]?.tokens ? (project.tokens / projects[0].tokens) * 100 : 0}%`,
                        }}
                        transition={{ duration: 0.12 }}
                        className="block h-full rounded-full bg-copper-400/70"
                      />
                    </div>
                  </div>
                  <span className="w-7 text-right text-11 tabular text-faint">
                    {project.sessions}
                  </span>
                </div>
              ))}
              {projects.length === 0 && (
                <div className="py-5 text-center text-11 text-muted">
                  Nothing recorded in this range.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="mt-3.5 flex items-center justify-between gap-4 rounded-[15px] border border-line/[0.06] bg-panel/55 px-4 py-3 text-11 text-faint">
        <span className="flex items-center gap-2">
          <Coins className="h-3.5 w-3.5" />
          {hasUnpricedUsage || hasIncompleteSavings ? "Estimates exclude unpriced or mixed-model sessions. " : ""}Standard short-context API rates; cache writes use the shortest standard duration. Cache savings excludes write costs. Subscription usage is not reflected.
        </span>
        <button
          type="button"
          onClick={() => openDialog({ kind: "explain-costs" })}
          className="hidden shrink-0 font-medium text-muted transition-colors hover:text-fg sm:block"
        >
          Method & pricing
        </button>
      </div>
    </PageScroll>
  );
}

function StatCard({
  label,
  value,
  meta,
  icon,
  delta,
  tint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  meta: string;
  icon: ReactNode;
  delta: number | null;
  tint: Tint;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-12 font-medium text-[var(--tint-ink)]/70">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-white/40 text-[var(--tint-ink)]/70 dark:bg-white/[0.055]">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0 truncate text-24 font-black leading-none tracking-[-0.045em] text-[var(--tint-ink)]">
          {value}
        </div>
        {delta !== null && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-0.5 rounded-full bg-white/35 px-1.5 py-0.5 text-11 font-semibold tabular dark:bg-white/[0.06]",
              delta >= 0 ? "text-success" : "text-danger",
            )}
            title="Compared with the previous period"
          >
            {delta >= 0 ? <ArrowUp className="h-2 w-2" /> : <ArrowDown className="h-2 w-2" />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="mt-1.5 text-11 leading-snug text-[var(--tint-ink)]/65">{meta}</div>
    </>
  );
  const className = cn(TINT_CLASS[tint], "relative min-w-0 overflow-hidden rounded-[19px] bg-[var(--tint-bg)] p-4 text-left");

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(className, "transition-colors")}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

function percentChange(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}
