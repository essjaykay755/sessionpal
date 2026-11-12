import { ProjectTiming } from "./Timing";
import { useMemo } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { AGENT_CLASS, AGENTS, TINT_CLASS } from "../lib/agents";
import {
  agentStats,
  canEstimateSessionCost,
  dailyUsage,
  modelStats,
  usageInWindow,
  type DayWindow,
  type ProjectCostStat,
} from "../lib/analytics";
import { usageTokens } from "../lib/pricing";
import { useApp } from "../lib/store";
import type { RangeKey } from "../lib/types";
import { cn, compact, money, number, pct, relativeTime } from "../lib/utils";
import { AgentMark } from "./Brand";
import { AreaChart } from "./charts";
import { projectIcon } from "./icons";
import { Button, EstimatedTag, Modal } from "./ui";

/** One project's usage and estimated cost over the selected period. */
export function ProjectDetail({
  project,
  range,
  rangeLabel,
  span,
  metric,
  color,
  onClose,
}: {
  project: ProjectCostStat | null;
  range: RangeKey;
  rangeLabel: string;
  span: DayWindow;
  metric: "tokens" | "cost";
  color: string;
  onClose: () => void;
}) {
  const Icon = projectIcon(project?.icon ?? "Folder");
  return (
    <Modal
      open={project !== null}
      onClose={onClose}
      width="xl"
      kicker={`Project · ${rangeLabel}`}
      title={project?.label ?? ""}
      description={project?.path || "No working folder recorded"}
      icon={
        project && (
          <span
            className={cn(
              TINT_CLASS[project.tint],
              "flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--tint-bg)] text-[var(--tint-ink)]",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )
      }
      footer={project && <DetailFooter project={project} onClose={onClose} />}
    >
      {project && (
        <DetailBody project={project} range={range} span={span} metric={metric} color={color} onClose={onClose} />
      )}
    </Modal>
  );
}

function DetailFooter({ project, onClose }: { project: ProjectCostStat; onClose: () => void }) {
  const { focusProject } = useApp();
  return (
    <>
      <span className="mr-auto flex items-center gap-2 text-11 text-faint">
        <EstimatedTag />
        API-equivalent estimate, not a bill.
      </span>
      <Button variant="ghost" size="sm" onClick={onClose}>
        Close
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          onClose();
          focusProject(project.key);
        }}
      >
        Open in Sessions
        <ArrowRight className="h-3 w-3" />
      </Button>
    </>
  );
}

function DetailBody({
  project,
  range,
  span,
  metric,
  color,
  onClose,
}: {
  project: ProjectCostStat;
  range: RangeKey;
  span: DayWindow;
  metric: "tokens" | "cost";
  color: string;
  onClose: () => void;
}) {
  const { settings, openSession, navigate, focusProject } = useApp();
  const pricing = settings.showCosts && metric === "cost" && project.pricedSessions > 0;
  const daily = useMemo(() => dailyUsage(project.members, range), [project.members, range]);
  const models = useMemo(() => modelStats(project.members, span), [project.members, span]);
  const agents = useMemo(
    () => agentStats(project.members, span).filter((agent) => agent.sessions > 0),
    [project.members, span],
  );
  const topSessions = useMemo(
    () =>
      project.members
        .map((session) => {
          const usage = usageInWindow(session, span);
          const priced = canEstimateSessionCost(session) && usage?.cost != null;
          return { session, tokens: usageTokens(usage), cost: priced ? usage?.cost ?? 0 : null };
        })
        .filter((row) => row.tokens > 0)
        .sort((a, b) =>
          pricing ? (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens : b.tokens - a.tokens,
        )
        .slice(0, 6),
    [project.members, span, pricing],
  );
  const partial = !project.costComplete;
  const agentTotal = agents.reduce((sum, agent) => sum + (pricing ? agent.cost : agent.tokens), 0) || 1;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Figure
          label="Est. cost"
          value={
            !settings.showCosts
              ? "Hidden"
              : project.pricedSessions === 0
                ? "Unpriced"
                : `${money(project.cost)}${partial ? "*" : ""}`
          }
          meta={partial && settings.showCosts ? `${project.pricedSessions} of ${project.sessionsWithUsage} priced` : "List prices"}
        />
        <Figure label="Tokens" value={compact(project.tokens)} meta={`${pct(project.tokenShare, 1)} of all usage`} />
        <Figure label="Sessions" value={number(project.sessions)} meta={`Last active ${relativeTime(project.lastActive)}`} />
        <Figure
          label="Est. cache savings"
          value={settings.showCosts ? money(project.cacheSavings) : "Hidden"}
          meta="From cache reads"
        />
      </div>

      <ProjectTiming period={project.timing} lifetime={project.lifetimeTiming} />

      <section>
        <h3 className="text-13 font-bold tracking-[-0.02em] text-fg">
          {pricing ? "Estimated spend per day" : "Tokens per day"}
        </h3>
        <AreaChart
          data={daily}
          getValue={(point) => (pricing ? point.cost : point.tokens)}
          getDate={(point) => point.date}
          formatValue={(value) => (pricing ? `$${value.toFixed(value < 10 ? 1 : 0)}` : compact(value))}
          color={color}
          height={130}
          showAxis
          animationKey={`${project.key}-${range}-${pricing}`}
          tooltip={(point) => (
            <div className="min-w-[120px]">
              <div className="text-11 font-medium text-white/45">
                {point.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </div>
              <div className="mt-1 text-14 font-bold leading-none">{compact(point.tokens)} tokens</div>
              <div className="mt-1 flex justify-between gap-3 text-11 text-white/45">
                <span>{number(point.sessions)} sessions</span>
                {settings.showCosts && <span>≈ {money(point.cost)}</span>}
              </div>
            </div>
          )}
        />
      </section>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <section>
          <h3 className="text-13 font-bold tracking-[-0.02em] text-fg">By model</h3>
          <div className="mt-2 space-y-2">
            {models.slice(0, 6).map((model) => (
              <div key={model.id} className="flex items-center gap-2 text-11">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: model.color }} />
                <span className="min-w-0 flex-1 truncate font-medium text-fg/85">{model.label}</span>
                <span className="tabular text-faint">{compact(model.tokens)}</span>
                <span className="w-14 text-right tabular text-muted">
                  {settings.showCosts && model.costKnown ? money(model.cost) : "—"}
                </span>
              </div>
            ))}
            {models.length > 6 && (
              <div className="text-11 text-faint">+{models.length - 6} more models</div>
            )}
            {models.length === 0 && <div className="text-11 text-muted">No model data in this range.</div>}
          </div>
        </section>

        <section>
          <h3 className="text-13 font-bold tracking-[-0.02em] text-fg">By agent</h3>
          <div className="mt-2 space-y-2.5">
            {agents.map((agent) => {
              const value = pricing ? agent.cost : agent.tokens;
              return (
                <div key={agent.id}>
                  <div className="flex items-center gap-2 text-11">
                    <span className={cn(AGENT_CLASS[agent.id], "text-[var(--agent)]")}>
                      <AgentMark agent={agent.id} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-fg/85">{AGENTS[agent.id].shortName}</span>
                    <span className="tabular text-faint">{number(agent.sessions)}</span>
                    <span className="w-14 text-right tabular text-muted">
                      {pricing ? money(agent.cost) : compact(agent.tokens)}
                    </span>
                  </div>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line/[0.06]">
                    <span
                      className={cn("block h-full rounded-full bg-[var(--agent)]", AGENT_CLASS[agent.id])}
                      style={{ width: `${(value / agentTotal) * 100}%` }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-13 font-bold tracking-[-0.02em] text-fg">
            {pricing ? "Most expensive sessions" : "Heaviest sessions"}
          </h3>
          <button
            type="button"
            onClick={() => {
              onClose();
              focusProject(project.key);
            }}
            className="text-11 font-medium text-muted transition-colors hover:text-fg"
          >
            All {number(project.sessions)} sessions
          </button>
        </div>
        <div className="-mx-2 mt-1.5">
          {topSessions.map(({ session, tokens, cost }) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                onClose();
                focusProject(project.key);
                openSession(session.id);
                navigate("sessions");
              }}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-sunken/50"
            >
              <span className={cn(AGENT_CLASS[session.agent], "flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[var(--agent-soft)] text-[var(--agent-ink)]")}>
                <AgentMark agent={session.agent} className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-12 font-semibold text-fg/90">{session.title}</span>
                <span className="block truncate text-11 text-faint">
                  {relativeTime(session.updatedAt)}
                  {session.branch ? ` · ${session.branch}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-11 tabular text-faint">{compact(tokens)}</span>
              <span className="w-14 shrink-0 text-right text-11 tabular text-fg/85">
                {!settings.showCosts ? "—" : cost === null ? "Unpriced" : money(cost)}
              </span>
            </button>
          ))}
          {topSessions.length === 0 && (
            <div className="px-2 py-4 text-11 text-muted">No usage recorded in this range.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-sunken/50 px-3 py-2.5">
      <div className="text-11 text-faint">{label}</div>
      <div className="mt-1 truncate text-18 font-black tabular tracking-[-0.04em] text-fg">{value}</div>
      <div className="mt-0.5 truncate text-11 text-faint">{meta}</div>
    </div>
  );
}
