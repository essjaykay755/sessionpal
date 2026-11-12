import { ACTIVE_TIME_HELP, timingCoverage, timingDuration } from "../lib/timing";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CaretDown, CaretUp } from "@phosphor-icons/react";
import { AGENT_CLASS, AGENTS, TINT_CLASS } from "../lib/agents";
import { dailyUsage, type ProjectCostStat } from "../lib/analytics";
import type { RangeKey } from "../lib/types";
import { cn, compact, money, number, pct, relativeTime } from "../lib/utils";
import { AgentMark } from "./Brand";
import { Sparkline } from "./charts";
import { projectIcon } from "./icons";
import { Button, EstimatedTag, SearchInput, Tooltip } from "./ui";

type SortKey = "label" | "sessions" | "tokens" | "cost" | "time" | "change";

const PAGE_SIZE = 10;

export function ProjectCostTable({
  projects,
  previous,
  range,
  rangeLabel,
  metric,
  showCosts,
  color,
  onOpen,
}: {
  projects: ProjectCostStat[];
  /** The same projects over the previous, equally long period. */
  previous: ProjectCostStat[];
  range: RangeKey;
  rangeLabel: string;
  metric: "tokens" | "cost";
  showCosts: boolean;
  color: string;
  onOpen: (project: ProjectCostStat) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const pricing = showCosts && metric === "cost";
  const activeSort = sort ?? { key: pricing ? "cost" : "tokens", desc: true };

  const previousByKey = useMemo(
    () => new Map(previous.map((project) => [project.key, project])),
    [previous],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const withChange = projects
      .filter(
        (project) =>
          !needle ||
          project.label.toLowerCase().includes(needle) ||
          project.path.toLowerCase().includes(needle),
      )
      .map((project) => {
        const before = previousByKey.get(project.key);
        // Comparing partial cost estimates would overstate the change.
        const comparable =
          !pricing || (project.costComplete && (!before || before.costComplete));
        const now = pricing ? project.cost : project.tokens;
        const then = before ? (pricing ? before.cost : before.tokens) : 0;
        const isNew = now > 0 && !then;
        return { project, isNew, change: comparable && !isNew ? percentChange(now, then) : null };
      });
    const direction = activeSort.desc ? -1 : 1;
    const value = (row: (typeof withChange)[number]): number | string => {
      switch (activeSort.key) {
        case "label":
          return row.project.label.toLowerCase();
        case "sessions":
          return row.project.sessions;
        case "tokens":
          return row.project.tokens;
        case "time":
          return row.project.timing.activeMs ?? -1;
        case "cost":
          return row.project.cost;
        case "change":
          return row.isNew ? Number.POSITIVE_INFINITY : row.change ?? Number.NEGATIVE_INFINITY;
      }
    };
    return withChange.sort((a, b) => {
      if (activeSort.key === "time") {
        if (a.project.timing.activeMs === null && b.project.timing.activeMs !== null) return 1;
        if (b.project.timing.activeMs === null && a.project.timing.activeMs !== null) return -1;
      }
      const left = value(a);
      const right = value(b);
      if (left < right) return -direction;
      if (left > right) return direction;
      return b.project.tokens - a.project.tokens;
    });
  }, [projects, previousByKey, query, activeSort.key, activeSort.desc, pricing]);

  const visible = expanded || query ? rows : rows.slice(0, PAGE_SIZE);

  // Only rows on screen need a trend line.
  const trends = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const { project } of visible) {
      map.set(
        project.key,
        dailyUsage(project.members, range).map((point) => (pricing ? point.cost : point.tokens)),
      );
    }
    return map;
  }, [visible, range, pricing]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => {
      const base = current ?? activeSort;
      return base.key === key ? { key, desc: !base.desc } : { key, desc: key !== "label" };
    });

  const partialCount = projects.filter((project) => !project.costComplete).length;
  const columns =
    "grid-cols-[minmax(0,1fr)_88px] sm:grid-cols-[minmax(0,1fr)_48px_56px_64px_88px_52px] lg:grid-cols-[minmax(0,1fr)_88px_48px_56px_64px_88px_80px_52px] xl:grid-cols-[minmax(0,1fr)_88px_48px_56px_64px_88px_80px_80px_52px]";

  return (
    <section id="projects" className="card mt-3.5 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <h2 className="text-16 font-bold tracking-[-0.03em]">Usage by project</h2>
          <p className="mt-1 text-11 text-muted">
            {number(projects.length)} {projects.length === 1 ? "project" : "projects"} ·{" "}
            {rangeLabel} · worktrees and subfolders count toward their repository
          </p>
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Filter projects"
          shortcut=""
          className="h-9 w-full sm:w-60"
        />
      </div>

      <div
        className={cn(
          "mt-4 grid gap-2 border-b border-line/[0.06] px-5 pb-2 text-11 font-medium text-faint sm:px-6",
          columns,
        )}
      >
        <SortHeader label="Project" sortKey="label" sort={activeSort} onSort={toggleSort} />
        <span className="hidden lg:block">Agents</span>
        <SortHeader label="Sessions" sortKey="sessions" sort={activeSort} onSort={toggleSort} align="right" responsive />
        <SortHeader label="Tokens" sortKey="tokens" sort={activeSort} onSort={toggleSort} align="right" responsive />
        <SortHeader
          label={showCosts ? "Est. cost" : "Cost"}
          sortKey="cost"
          responsive
          sort={activeSort}
          onSort={toggleSort}
          align="right"
        />
        <SortHeader label="Est. active time" sortKey="time" sort={activeSort} onSort={toggleSort} align="right" />
        <span className="hidden text-right xl:block">Share</span>
        <span className="hidden text-right lg:block">Trend</span>
        <SortHeader label="Change" sortKey="change" sort={activeSort} onSort={toggleSort} align="right" responsive />
      </div>

      <div className="px-2 pb-2 pt-1 sm:px-2.5">
        {visible.map(({ project, change, isNew }) => {
          const Icon = projectIcon(project.icon);
          const share = pricing ? project.costShare : project.tokenShare;
          return (
            <div
              key={project.key}
              role="button"
              tabIndex={0}
              aria-label={`Open ${project.label}`}
              onClick={() => onOpen(project)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(project);
                }
              }}
              className={cn(
                "grid cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2.5 outline-none transition-colors hover:bg-sunken/40 focus-visible:bg-sunken/40",
                columns,
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    TINT_CLASS[project.tint],
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[var(--tint-bg)] text-[var(--tint-ink)]",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-12 font-semibold text-fg/90">{project.label}</div>
                  <div className="truncate text-11 text-faint" title={project.path || undefined}>
                    {project.path || "No working folder recorded"}
                    {project.models.length > 0 &&
                      ` · ${project.models[0]}${project.models.length > 1 ? ` +${project.models.length - 1} more` : ""}`}
                  </div>
                </div>
              </div>
              <div className="hidden items-center gap-1 lg:flex">
                {project.agents.map((agent) => (
                  <Tooltip key={agent} label={AGENTS[agent].name} side="top">
                    <span className={cn(AGENT_CLASS[agent], "text-[var(--agent)]")}>
                      <AgentMark agent={agent} className="h-3.5 w-3.5" />
                    </span>
                  </Tooltip>
                ))}
              </div>
              <div className="hidden text-right text-11 tabular text-muted sm:block">
                {number(project.sessions)}
              </div>
              <div className="hidden text-right text-11 tabular text-muted sm:block">{compact(project.tokens)}</div>
              <div className="hidden text-right text-11 tabular text-fg/85 sm:block">
                {!showCosts ? (
                  "—"
                ) : project.pricedSessions === 0 ? (
                  <span className="text-faint">{project.sessionsWithUsage ? "Unpriced" : "—"}</span>
                ) : (
                  <span className="inline-flex items-center justify-end gap-0.5">
                    {money(project.cost)}
                    {!project.costComplete && (
                      <Tooltip
                        label={`${project.pricedSessions} of ${project.sessionsWithUsage} sessions priced`}
                        side="top"
                      >
                        <span className="cursor-default text-copper-500">*</span>
                      </Tooltip>
                    )}
                  </span>
                )}
              </div>
              <div className="text-right text-11 tabular text-fg/85" title={`${ACTIVE_TIME_HELP} ${timingCoverage(project.timing)}`}>
                {timingDuration(project.timing.activeMs)}
                {project.timing.activeMs !== null && project.timing.coveredSessions < project.timing.totalSessions && <span className="ml-0.5 text-copper-500">*</span>}
              </div>
              <div className="hidden items-center justify-end gap-2 xl:flex">
                <span className="h-1.5 w-10 overflow-hidden rounded-full bg-line/[0.06]">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${share}%`, backgroundColor: color }}
                  />
                </span>
                <span className="w-9 text-right text-11 tabular text-faint">{pct(share, share < 10 ? 1 : 0)}</span>
              </div>
              <div className="hidden justify-end lg:flex" title={`Last active ${relativeTime(project.lastActive)}`}>
                <Sparkline
                  data={trends.get(project.key) ?? []}
                  color={color}
                  className="h-6 w-[88px]"
                  strokeWidth={1.4}
                />
              </div>
              <div className="hidden justify-end text-11 font-semibold tabular sm:flex">
                {isNew ? (
                  <span className="font-medium text-muted" title="No usage in the previous period">New</span>
                ) : change === null ? (
                  <span className="font-normal text-faint">—</span>
                ) : (
                  <span
                    className={cn("flex items-center gap-0.5", change >= 0 ? "text-success" : "text-danger")}
                    title="Compared with the previous period"
                  >
                    {change >= 0 ? <ArrowUp className="h-2 w-2" /> : <ArrowDown className="h-2 w-2" />}
                    {Math.abs(change) >= 1000 ? "999+" : Math.abs(change).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-12 text-muted">
            {query ? "No projects match this filter." : "No sessions recorded in this range."}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/[0.06] px-5 py-3 text-11 text-faint sm:px-6">
        <span className="flex items-center gap-2">
          <EstimatedTag />
          <span>
            {partialCount > 0 && showCosts
              ? "* Some of the project's sessions could not be priced, so its cost is a lower bound. Change is shown only when both periods are fully priced. "
              : ""}
            Usage inside the selected period only. Active time excludes gaps over 15 minutes; * marks partial timing coverage.
          </span>
        </span>
        {!query && rows.length > PAGE_SIZE && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-11"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show fewer" : `Show all ${number(rows.length)}`}
          </Button>
        )}
      </div>
    </section>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  responsive = false,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  /** Hidden on the narrowest layout, like its column. */
  responsive?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}
      className={cn(
        responsive ? "hidden sm:flex" : "flex",
        "items-center gap-0.5 transition-colors hover:text-fg",
        align === "right" && "justify-end",
        active && "text-fg/80",
      )}
    >
      {label}
      {active && (sort.desc ? <CaretDown className="h-2.5 w-2.5" /> : <CaretUp className="h-2.5 w-2.5" />)}
    </button>
  );
}

export function percentChange(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}
