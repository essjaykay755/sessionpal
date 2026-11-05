import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowClockwise,
  ArrowRight,
  ArrowUpRight,
  ChartLineUp,
  ChatCircleDots,
  Clock,
  Copy,
  Export,
  FolderOpen,
  HardDrives,
  Coins,
  Trash,
  WarningCircle,
  Archive,
} from "@phosphor-icons/react";
import { AGENT_CLASS, AGENTS, AGENT_ORDER } from "../lib/agents";
import {
  additionsInRange,
  agentStats,
  cumulativeSessionSeries,
  filterRange,
  RANGE_SHORT,
  usageTotals,
} from "../lib/analytics";
import { demoSessionDetail } from "../lib/demo";
import { modelInfo } from "../lib/pricing";
import { useApp } from "../lib/store";
import type { AgentId, RangeKey, SessionSummary } from "../lib/types";
import {
  bytes,
  cn,
  compact,
  money,
  number,
  pct,
  relativeTime,
  shortDate,
} from "../lib/utils";
import { AgentMark } from "../components/Brand";
import { AreaChart } from "../components/charts";
import { SessionGlyph } from "../components/SessionGlyph";
import { BackupStatusIcon, backupFreshness, backupHeadline } from "../components/BackupStatus";
import { PageHeader, PageScroll, SectionTitle } from "../components/PageChrome";
import {
  AgentBadge,
  AnimatedNumber,
  Button,
  EmptyState,
  EstimatedTag,
  KebabMenu,
  Segmented,
} from "../components/ui";
import { projectIcon } from "../components/icons";

const RANGE_PHRASE: Record<RangeKey, string> = {
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  "1y": "last year",
};

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = (
  ["7d", "30d", "90d", "1y"] as RangeKey[]
).map((value) => ({ value, label: RANGE_SHORT[value] }));

export default function OverviewPage() {
  const {
    sessions,
    backups,
    activity,
    detections,
    lastScanAt,
    rescan,
    loading,
    settings,
    effectiveTheme,
    navigate,
    focusAgent,
    openSession,
    openDialog,
    revealLocation,
    notify,
  } = useApp();
  const [range, setRange] = useState<RangeKey>("30d");

  const totalStorage = useMemo(
    () => sessions.reduce((sum, session) => sum + session.sizeBytes, 0),
    [sessions],
  );
  const recentUsageSessions = useMemo(() => filterRange(sessions, "30d"), [sessions]);
  const usage30 = useMemo(() => usageTotals(recentUsageSessions), [recentUsageSessions]);
  const hasUnpricedUsage = usage30.pricedSessions < usage30.sessionsWithUsage;
  const agents = useMemo(() => agentStats(sessions), [sessions]);
  const chart = useMemo(
    () => cumulativeSessionSeries(sessions, range),
    [sessions, range],
  );
  const additions = useMemo(() => additionsInRange(sessions, range), [sessions, range]);
  const recent = useMemo(() => sessions.slice(0, 10), [sessions]);
  const latestBackup = backups[0];
  const detected = detections.filter((agent) => agent.available).length || agents.filter((agent) => agent.sessions > 0).length;
  const formats = Array.from(new Set(sessions.map((session) => session.format.toUpperCase()))).join(" · ");
  const chartColor = effectiveTheme === "dark" ? "#dd9a75" : "#b8693f";

  const sessionActions = (session: SessionSummary) => [
    {
      label: "Open session",
      icon: <ChatCircleDots className="h-3.5 w-3.5" />,
      onSelect: () => {
        openSession(session.id);
        navigate("sessions");
      },
    },
    {
      label: "Export transcript",
      icon: <Export className="h-3.5 w-3.5" />,
      onSelect: () => openDialog({ kind: "export-sessions", ids: [session.id] }),
    },
    {
      label: "Reveal in Finder",
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      onSelect: () => void revealLocation(session.path, session.title),
    },
    {
      label: "Show in library",
      icon: <Copy className="h-3.5 w-3.5" />,
      onSelect: () => {
        openSession(session.id);
        navigate("sessions");
      },
    },
    {
      label: "Delete session",
      icon: <Trash className="h-3.5 w-3.5" />,
      danger: true,
      onSelect: () => openDialog({ kind: "delete-sessions", ids: [session.id] }),
    },
  ];

  if (!loading && sessions.length === 0) {
    return (
      <PageScroll>
        <PageHeader
          title="Overview"
          subtitle="Your library at a glance. Everything stays on this device."
        />
        <div className="card overflow-hidden">
          <EmptyState
            icon={<Archive className="h-5 w-5" />}
            title="No sessions found yet"
            description="SessionPal looked in the standard Claude Code, Codex, Cursor, OpenCode and Antigravity locations but found nothing. Start a session, then scan again."
            action={
              <Button variant="copper" icon={<ArrowClockwise className="h-4 w-4" />} onClick={() => void rescan()}>
                Scan local storage
              </Button>
            }
          />
        </div>
      </PageScroll>
    );
  }

  return (
    <PageScroll>
      <PageHeader
        title="Overview"
        subtitle="Your library at a glance. Everything stays on this device."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowClockwise className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
            onClick={() => void rescan()}
          >
            Rescan
          </Button>
        }
      />

      <motion.section
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12 }}
        className="card overflow-hidden"
      >
        <div className="flex flex-col lg:flex-row">
          <div className="min-w-0 flex-1 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-13 font-semibold text-muted">Sessions in your library</h2>
                <div className="mt-1.5 flex items-end gap-3">
                  <AnimatedNumber
                    value={sessions.length}
                    className="text-40 font-black leading-none tracking-[-0.05em] text-fg"
                  />
                  <span className="pb-1 text-12 leading-tight text-muted">
                    across
                    <br />
                    {detected} agents
                  </span>
                </div>
              </div>
              <Segmented value={range} options={RANGE_OPTIONS} onChange={setRange} compact />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-11 text-faint">
              <span className="inline-flex items-center gap-1 rounded-full bg-copper-100/70 px-2 py-1 font-medium text-copper-700 dark:bg-copper-500/15 dark:text-copper-300">
                <ArrowUpRight className="h-2.5 w-2.5" />
                {number(additions)} new in the {RANGE_PHRASE[range]}
              </span>
              <span>Library size over the {RANGE_PHRASE[range]}</span>
            </div>

            <div className="-mb-3 mt-1">
              <AreaChart
                data={chart}
                getValue={(point) => point.value}
                getDate={(point) => point.date}
                formatValue={(value) => compact(value)}
                color={chartColor}
                height={150}
                showAxis={false}
                showXLabels
                zeroBaseline={false}
                animationKey={range}
                tooltip={(point) => (
                  <div>
                    <div className="text-11 font-medium text-white/45">
                      {point.date.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    <div className="mt-1 text-18 font-bold leading-none tracking-[-0.03em]">
                      {number(point.value)}
                    </div>
                    <div className="mt-1 text-11 text-white/40">sessions in library</div>
                  </div>
                )}
              />
            </div>
          </div>

          <dl className="grid shrink-0 grid-cols-2 border-t border-line/[0.06] bg-sunken/30 sm:grid-cols-4 lg:w-[232px] lg:grid-cols-1 lg:border-l lg:border-t-0">
            <HeroStat
              icon={<HardDrives className="h-3.5 w-3.5" />}
              label="On disk"
              value={bytes(totalStorage)}
              detail={formats}
            />
            <HeroStat
              icon={<ChartLineUp className="h-3.5 w-3.5" />}
              label="30-day tokens"
              value={compact(usage30.tokens)}
              detail={`${number(usage30.sessions)} active sessions`}
            />
            {settings.showCosts && (
              <HeroStat
                icon={<Coins className="h-3.5 w-3.5" />}
                label={
                  <span className="flex items-center gap-1.5">
                    Estimated value <EstimatedTag />
                  </span>
                }
                value={usage30.pricedSessions ? money(usage30.cost) : "—"}
                detail={hasUnpricedUsage ? `${usage30.pricedSessions}/${usage30.sessionsWithUsage} priced` : "API-equivalent"}
              />
            )}
            <HeroStat
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Last scan"
              value={relativeTime(lastScanAt)}
              detail={`${detected} of ${AGENT_ORDER.length} agents found`}
            />
          </dl>
        </div>
      </motion.section>

      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="card overflow-hidden lg:col-span-8">
          <div className="flex items-center justify-between gap-4 px-5 pt-5 sm:px-6">
            <h2 className="text-16 font-bold tracking-[-0.035em]">Recent sessions</h2>
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 px-2 text-12"
              onClick={() => navigate("sessions")}
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          <div className="mt-4 hidden grid-cols-[minmax(0,1fr)_76px_66px_28px] gap-3 xl:grid-cols-[minmax(0,1fr)_104px_76px_66px_28px] border-b border-line/[0.06] px-5 pb-2.5 text-11 font-medium text-faint sm:grid sm:px-6">
            <span>Session</span>
            <span className="hidden xl:block">Agent</span>
            <span>Updated</span>
            <span className="text-right">Tokens</span>
            <span />
          </div>

          <div className="px-2 py-1 sm:px-2.5">
            {recent.map((session, index) => {
              const Icon = projectIcon(session.icon);
              return (
                <motion.div
                  key={session.id}
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.12 }}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    openSession(session.id);
                    navigate("sessions");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openSession(session.id);
                      navigate("sessions");
                    }
                  }}
                  className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_28px] items-center gap-3 rounded-[14px] px-3 py-2.5 outline-none transition-colors duration-200 hover:bg-sunken/55 focus-visible:bg-sunken/55 sm:grid-cols-[minmax(0,1fr)_76px_66px_28px] sm:px-3.5 xl:grid-cols-[minmax(0,1fr)_104px_76px_66px_28px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <SessionGlyph agent={session.agent} icon={Icon} />
                    <div className="min-w-0">
                      <div className="truncate text-13 font-semibold tracking-[-0.015em] text-fg">
                        {session.title}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-11 text-muted">
                        <span className="max-w-[45%] shrink-0 truncate">{session.projectLabel}</span>
                        <span className="h-[2.5px] w-[2.5px] shrink-0 rounded-full bg-faint/50" />
                        <span className="hidden min-w-0 truncate sm:inline">{session.excerpt}</span>
                      </div>
                    </div>
                  </div>
                  <div className="hidden xl:block">
                    <AgentBadge agent={session.agent} compact />
                  </div>
                  <div className="hidden text-11 text-muted sm:block">
                    {relativeTime(session.updatedAt)}
                  </div>
                  <div className="hidden text-right text-11 tabular text-muted sm:block">
                    {session.usage ? compact(session.tokens) : "—"}
                  </div>
                  <div className="flex justify-end">
                    <KebabMenu
                      items={sessionActions(session)}
                      label={`Actions for ${session.title}`}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-14 font-bold tracking-[-0.025em]">Agents</h2>
              <span className="text-11 text-faint">
                {detected} of {AGENT_ORDER.length} found
              </span>
            </div>
            <div
              className="mt-3.5 flex h-2 gap-[3px] overflow-hidden rounded-full bg-line/[0.06]"
              role="img"
              aria-label={AGENT_ORDER.map((agent) => {
                const share = agents.find((item) => item.id === agent)?.share ?? 0;
                return `${AGENTS[agent].name} ${pct(share, 0)}`;
              }).join(", ")}
            >
              {AGENT_ORDER.map((agent) => {
                const share = agents.find((item) => item.id === agent)?.share ?? 0;
                if (share <= 0) return null;
                return (
                  <span
                    key={agent}
                    className={`${AGENT_CLASS[agent]} h-full bg-[var(--agent)] first:rounded-l-full last:rounded-r-full`}
                    style={{ width: `${share}%` }}
                  />
                );
              })}
            </div>
            <ul className="mt-3 -mx-2">
              {AGENT_ORDER.map((agent) => {
                const stats = agents.find((item) => item.id === agent);
                const found = detections.length
                  ? detections.some((item) => item.id === agent && item.available)
                  : (stats?.sessions ?? 0) > 0;
                return (
                  <li key={agent}>
                    <button
                      type="button"
                      onClick={() => focusAgent(agent)}
                      aria-label={`Browse ${AGENTS[agent].name} sessions`}
                      className={`${AGENT_CLASS[agent]} flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-sunken/55`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--agent-soft)] text-[var(--agent-ink)]">
                        <AgentMark agent={agent} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-12 font-semibold text-fg/90">
                          {AGENTS[agent].name}
                        </span>
                        <span className="block text-11 text-faint">
                          {found ? `${number(stats?.sessions ?? 0)} sessions` : "Not found on this device"}
                        </span>
                      </span>
                      <span className="text-12 font-semibold tabular text-muted">
                        {found ? pct(stats?.share ?? 0, 0) : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-14 font-bold tracking-[-0.025em]">Backups</h2>
              <button
                type="button"
                onClick={() => navigate("backups")}
                className="flex items-center gap-1 text-11 font-medium text-muted transition-colors hover:text-fg"
              >
                Manage
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <BackupStatusIcon freshness={backupFreshness(latestBackup)} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-13 font-semibold text-fg">
                  {backupHeadline(latestBackup)}
                </div>
                <div className="truncate text-11 text-muted">
                  {latestBackup
                    ? `${number(Math.min(latestBackup.sessionCount, sessions.length))} of ${number(sessions.length)} sessions`
                    : "Nothing is protected yet"}
                </div>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/[0.06]">
              <span
                className="block h-full rounded-full bg-[#81976a]"
                style={{
                  width: `${sessions.length && latestBackup ? Math.min(100, (latestBackup.sessionCount / sessions.length) * 100) : 0}%`,
                }}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4 w-full"
              icon={<Archive className="h-3.5 w-3.5" />}
              onClick={() => openDialog({ kind: "create-backup" })}
            >
              Create backup
            </Button>
          </div>

          <div className="card flex-1 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-14 font-bold tracking-[-0.025em]">Recent activity</h2>
              <span className="flex items-center gap-1.5 text-11 text-faint">
                <span className="h-1.5 w-1.5 rounded-full bg-[#7f9664]" />
                On device
              </span>
            </div>
            <div className="mt-3 flex flex-col">
              {activity.slice(0, 4).map((event, index) => {
                const icon =
                  event.kind === "backup" ? (
                    <Archive className="h-3.5 w-3.5" />
                  ) : event.kind === "export" ? (
                    <Export className="h-3.5 w-3.5" />
                  ) : event.kind === "delete" ? (
                    <Trash className="h-3.5 w-3.5" />
                  ) : event.kind === "scan" ? (
                    <ArrowClockwise className="h-3.5 w-3.5" />
                  ) : (
                    <ChatCircleDots className="h-3.5 w-3.5" />
                  );
                return (
                  <div
                    key={event.id}
                    className={cn(
                      "flex items-start gap-3 py-2.5",
                      index !== 0 && "border-t border-line/[0.055]",
                    )}
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-line/[0.05] text-muted">
                      {icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-12 font-semibold text-fg/85" title={event.title}>
                        {event.title}
                      </div>
                      <div className="mt-0.5 truncate text-11 text-muted/80" title={event.detail}>
                        <span className="text-faint">{relativeTime(event.at)}</span>
                        <span className="mx-1 text-faint/60">·</span>
                        {event.detail}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </PageScroll>
  );
}

function HeroStat({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 border-line/[0.06] px-5 py-3.5 [&:not(:first-child)]:border-l sm:py-4 lg:flex lg:flex-1 lg:flex-col lg:justify-center lg:[&:not(:first-child)]:border-l-0 lg:[&:not(:first-child)]:border-t">
      <dt className="flex items-center gap-1.5 text-11 font-medium text-faint">
        <span className="text-faint">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 whitespace-nowrap text-16 font-bold tabular tracking-[-0.02em] text-fg">
        {value}
      </dd>
      <dd className="truncate text-11 text-faint" title={detail}>
        {detail}
      </dd>
    </div>
  );
}
