import { useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowRight, Coins, Info } from "@phosphor-icons/react";
import { AGENT_CLASS, AGENTS, AGENT_ORDER, TINT_CLASS } from "../lib/agents";
import {
  agentStats,
  dailyUsage,
  modelStats,
  overlapsWindow,
  projectCostStats,
  RANGE_LABELS,
  RANGE_SHORT,
  rangeWindow,
  sessionUsageParts,
  undatedUsageSessions,
  usageTotals,
} from "../lib/analytics";
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
import { ProjectCostTable } from "../components/ProjectCostTable";
import { ProjectDetail } from "../components/ProjectDetail";
import { PageHeader, PageScroll, SectionNav, SectionTitle } from "../components/PageChrome";
import { AgentBadge, AnimatedNumber, Button, EstimatedTag, Segmented } from "../components/ui";

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = (
  ["7d", "30d", "90d", "1y"] as RangeKey[]
).map((value) => ({ value, label: RANGE_SHORT[value] }));

export default function UsagePage() {
  const { sessions, settings, openDialog, updateSettings, focusAgent, effectiveTheme } =
    useApp();
  const [section, setSection] = useState<"overview" | "projects" | "models">("overview");
  const [range, setRange] = useState<RangeKey>("30d");
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");

  const span = useMemo(() => rangeWindow(range), [range]);
  const ranged = useMemo(() => sessions.filter((session) => overlapsWindow(session, span)), [sessions, span]);
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
  const daily = useMemo(() => dailyUsage(sessions, range), [sessions, range]);
  const undated = useMemo(() => undatedUsageSessions(ranged), [ranged]);
  const agents = useMemo(() => agentStats(ranged, span), [ranged, span]);
  const models = useMemo(() => modelStats(ranged, span), [ranged, span]);
  const parts = useMemo(() => sessionUsageParts(ranged, span), [ranged, span]);
  const projectCosts = useMemo(() => projectCostStats(ranged, span, sessions), [ranged, span, sessions]);
  const previousProjectCosts = useMemo(
    () => projectCostStats(previous, previousWindow),
    [previous, previousWindow],
  );
  const [openProjectKey, setOpenProjectKey] = useState<string | null>(null);
  const openProject = useMemo(
    () => projectCosts.find((project) => project.key === openProjectKey) ?? null,
    [projectCosts, openProjectKey],
  );
  const rankByCost = displayedMetric === "cost" && settings.showCosts;
  const projects = useMemo(
    () =>
      [...projectCosts]
        .sort((a, b) => (rankByCost ? b.cost - a.cost : 0) || b.tokens - a.tokens)
        .slice(0, 5)
        .map((project) => ({ ...project, value: rankByCost ? project.cost : project.tokens })),
    [projectCosts, rankByCost],
  );

  const chartColor =
    displayedMetric === "cost"
      ? effectiveTheme === "dark"
        ? "#d39a76"
        : "#b8693f"
      : effectiveTheme === "dark"
        ? "#9cbcc1"
        : "#547983";

  const cacheShare = totals.tokens ? (totals.cacheRead / totals.tokens) * 100 : 0;
  const tokenTotal = parts.reduce((sum, part) => sum + part.value, 0) || 1;

  return (
    <PageScroll>
      <PageHeader
        title="Usage & cost"
        titleClassName="text-[34px] tracking-[-0.045em]"
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

      <SectionNav
        label="Usage sections"
        idPrefix="usage-section"
        value={section}
        onChange={setSection}
        options={[
          { value: "overview", label: "Overview" },
          { value: "projects", label: "Projects" },
          { value: "models", label: "Models & agents" },
        ]}
      />
      {section === "overview" && (
        <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UsageSummaryCard
          label="Token composition"
          tint="sky"
          value={<AnimatedNumber value={totals.tokens} format={compact} />}
          meta={`${compact(totals.input)} in · ${compact(totals.output)} out · ${compact(totals.cacheRead)} cache read${totals.cacheWrite ? ` · ${compact(totals.cacheWrite)} cache write` : ""}`}
        />
        <UsageSummaryCard
          label="API-equivalent spend"
          tint="peach"
          value={settings.showCosts ? (hasPricedSessions ? <AnimatedNumber value={totals.cost} format={(value) => money(value)} /> : "Unavailable") : "Hidden"}
          meta={settings.showCosts ? (hasUnpricedUsage ? `${totals.pricedSessions} of ${totals.sessionsWithUsage} sessions priced` : "Standard API rates") : "Tap to show estimates"}
          estimated={settings.showCosts && hasPricedSessions}
          onClick={!settings.showCosts ? () => updateSettings({ showCosts: true }) : undefined}
        />
        <UsageSummaryCard
          label="Prompt cache savings"
          tint="sage"
          value={
            settings.showCosts && totals.savingsSessions > 0 ? (
              <AnimatedNumber value={totals.cacheSavings} format={(value) => money(value)} />
            ) : (
              settings.showCosts ? "Unavailable" : "Hidden"
            )
          }
          meta={!settings.showCosts ? "Estimates are hidden" : hasIncompleteSavings ? `${totals.savingsSessions} of ${totals.sessionsWithUsage} sessions priced` : `${pct(cacheShare, 1)} of total tokens served from cache`}
        />
        <UsageSummaryCard
          label="Sessions"
          tint="butter"
          value={<AnimatedNumber value={totals.sessions} format={number} />}
          meta={`${number(totals.sessionsWithUsage)} include token data`}
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

        <div className="lg:col-span-4">
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

        </div>
      </section>
        </>
      )}
      {section === "projects" && (
        <>
          <div className="mb-3 flex justify-end">
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
          <div className="max-w-[700px]">
          <div className="card flex-1 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-14 font-bold tracking-[-0.025em]">
                Top projects
                <span className="ml-1.5 text-11 font-medium text-faint">
                  by {rankByCost ? "est. cost" : "tokens"}
                </span>
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-11"
                onClick={() =>
                  document.getElementById("projects")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                All projects
                <ArrowRight className="h-2.5 w-2.5" />
              </Button>
            </div>
            <div className="mt-3 space-y-2.5">
              {projects.map((project, index) => (
                <button
                  key={project.key}
                  type="button"
                  onClick={() => setOpenProjectKey(project.key)}
                  className="-mx-1.5 flex w-[calc(100%+12px)] items-center gap-2.5 rounded-[8px] px-1.5 py-0.5 text-left transition-colors hover:bg-sunken/45"
                >
                  <span className="w-3 text-11 tabular text-faint">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-11 font-medium text-fg/85">
                        {project.label}
                      </span>
                      <span className="shrink-0 text-11 tabular text-faint">
                        {rankByCost ? (
                          <>
                            {money(project.cost)}
                            {!project.costComplete && "*"}
                          </>
                        ) : (
                          compact(project.tokens)
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-line/[0.055]">
                      <motion.span
                        initial={false}
                        animate={{
                          width: `${projects[0]?.value ? (project.value / projects[0].value) * 100 : 0}%`,
                        }}
                        transition={{ duration: 0.12 }}
                        className="block h-full rounded-full bg-copper-400/70"
                      />
                    </div>
                  </div>
                  <span className="w-7 text-right text-11 tabular text-faint">
                    {project.sessions}
                  </span>
                </button>
              ))}
              {projects.length === 0 && (
                <div className="py-5 text-center text-11 text-muted">
                  Nothing recorded in this range.
                </div>
              )}
            </div>
          </div>
          </div>
      <ProjectCostTable
        projects={projectCosts}
        previous={previousProjectCosts}
        range={range}
        rangeLabel={RANGE_LABELS[range]}
        metric={displayedMetric}
        showCosts={settings.showCosts}
        color={chartColor}
        onOpen={(project) => setOpenProjectKey(project.key)}
      />

        </>
      )}
      {section === "models" && (
        <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
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
                    <div className="truncate text-12 font-semibold text-fg/90">{model.label}{model.id === "claude-haiku-5-5" || /^claude-haiku-5-5-\d{8}$/.test(model.id) ? "*" : ""}</div>
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
      )}

      <ProjectDetail
        project={openProject}
        range={range}
        rangeLabel={RANGE_LABELS[range]}
        span={span}
        metric={displayedMetric}
        color={chartColor}
        onClose={() => setOpenProjectKey(null)}
      />

      <div className="mt-3.5 flex items-center justify-between gap-4 rounded-[15px] border border-line/[0.06] bg-panel/55 px-4 py-3 text-11 text-faint">
        <span className="flex items-center gap-2">
          <Coins className="h-3.5 w-3.5" />
          {hasUnpricedUsage || hasIncompleteSavings ? "Estimates exclude unpriced or mixed-model sessions. " : ""}Estimates use current API rates, including paid equivalents of recognized free models. Rates may differ by provider; missing cache rates use input pricing. Subscription usage is not reflected. * Haiku 5.5 uses base rates; prompts over 100,000 tokens cost more.
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

function UsageSummaryCard({
  label,
  value,
  meta,
  estimated,
  tint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  meta: string;
  estimated?: boolean;
  tint: Tint;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex min-h-[2.5em] items-start gap-2 text-13 font-medium leading-snug text-[var(--tint-ink)]">
        <span className="opacity-80">{label}</span>
        {estimated && <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-11 font-medium text-muted" title="Estimated from public API list prices, not a bill">Est.</span>}
      </div>
      <div className="mt-1 flex min-w-0 items-baseline">
        <div className="min-w-0 break-words text-[28px] font-black leading-none tracking-[-0.045em] text-[var(--tint-ink)]">
          {value}
        </div>
      </div>
      <div className="mt-2 text-12 leading-relaxed text-[var(--tint-ink)] opacity-80">{meta}</div>
    </>
  );
  const className = cn("card min-w-0 p-5 text-left sm:p-6", TINT_CLASS[tint]);

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(className, "transition-colors hover:border-line/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500")}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}
