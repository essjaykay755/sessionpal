import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Archive,
  ArrowsClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  Copy,
  Database,
  Export,
  FolderOpen,
  HardDrives,
  Info,
  MagnifyingGlass,
  Minus,
  ShieldCheck,
  Trash,
} from "@phosphor-icons/react";
import { AGENT_CLASS, AGENTS, AGENT_ORDER } from "../lib/agents";
import { platform, trashName } from "../lib/native";
import { matchesSession, searchTokens, SESSION_SEARCH_PLACEHOLDER } from "../lib/search";
import { useContentSearch } from "../lib/useContentSearch";
import { useApp } from "../lib/store";
import type { AgentId, SessionSummary } from "../lib/types";
import { bytes, cn, compact, number, relativeTime } from "../lib/utils";
import { AgentMark } from "../components/Brand";
import { projectIcon } from "../components/icons";
import { SessionGlyph } from "../components/SessionGlyph";
import { PageHeader, PageScroll } from "../components/PageChrome";
import {
  AgentBadge,
  Button,
  EmptyState,
  KebabMenu,
  SearchInput,
} from "../components/ui";

type SortKey = "recent" | "oldest" | "largest" | "tokens";
type AgeFilter = "any" | "90d" | "6m";

const PAGE_SIZE = 25;

export default function ManagePage() {
  const {
    sessions,
    detections,
    backups,
    openSession,
    navigate,
    openDialog,
    revealLocation,
    copyPath,
    rescan,
    loading,
    demo,
    native,
  } = useApp();
  const [query, setQuery] = useState("");
  const contentSearch = useContentSearch(query, native && !demo);
  const [agent, setAgent] = useState<AgentId | "all">("all");
  const [age, setAge] = useState<AgeFilter>("any");
  const [project, setProject] = useState("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isWindows = platform() === "windows";
  const revealLabel = isWindows ? "Show in Explorer" : "Reveal in Finder";

  useEffect(() => {
    setPage(0);
  }, [query, agent, age, project, sort]);

  useEffect(() => {
    setSelected((current) => {
      const next = new Set<string>();
      for (const id of current) if (sessions.some((session) => session.id === id)) next.add(id);
      return next.size === current.size ? current : next;
    });
  }, [sessions]);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) map.set(session.project, session.projectLabel);
    return Array.from(map.entries())
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions]);

  const filtered = useMemo(() => {
    const tokens = searchTokens(query);
    const now = Date.now();
    return sessions
      .filter((session) => {
        if (agent !== "all" && session.agent !== agent) return false;
        if (project !== "all" && session.project !== project) return false;
        if (age !== "any") {
          const olderThan = age === "90d" ? 90 : 182;
          if (now - new Date(session.updatedAt).getTime() < olderThan * 86_400_000) return false;
        }
        return matchesSession(session, tokens) || contentSearch.hits.has(session.id);
      })
      .sort((a, b) => {
        switch (sort) {
          case "oldest":
            return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          case "largest":
            return b.sizeBytes - a.sizeBytes;
          case "tokens":
            return b.tokens - a.tokens;
          default:
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        }
      });
  }, [sessions, agent, age, project, query, sort, contentSearch.hits]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const selectedSessions = useMemo(
    () => sessions.filter((session) => selected.has(session.id)),
    [sessions, selected],
  );
  const selectedSize = selectedSessions.reduce((sum, session) => sum + session.sizeBytes, 0);
  const selectedDeletable = selectedSessions.filter((session) => session.deletable);
  const selectedBytesDeletable = selectedDeletable.reduce(
    (sum, session) => sum + session.sizeBytes,
    0,
  );

  const allPageSelected = pageItems.length > 0 && pageItems.every((session) => selected.has(session.id));
  const somePageSelected = pageItems.some((session) => selected.has(session.id));

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allPageSelected) {
        pageItems.forEach((session) => next.delete(session.id));
      } else {
        pageItems.forEach((session) => next.add(session.id));
      }
      return next;
    });
  };

  const totalSize = useMemo(
    () => sessions.reduce((sum, session) => sum + session.sizeBytes, 0),
    [sessions],
  );

  const agentStorage = useMemo(() => {
    return AGENT_ORDER.map((id) => {
      const scoped = sessions.filter((session) => session.agent === id);
      const size = scoped.reduce((sum, session) => sum + session.sizeBytes, 0);
      const detection = detections.find((item) => item.id === id);
      return {
        id,
        sessions: scoped.length,
        size,
        root: detection?.roots[0] ?? AGENTS[id].defaultRoot,
        available: detection?.available ?? scoped.length > 0,
        share: totalSize ? (size / totalSize) * 100 : 0,
      };
    });
  }, [sessions, detections, totalSize]);

  const rowMenu = (session: SessionSummary) => [
    {
      label: "Open conversation",
      icon: <MagnifyingGlass className="h-3.5 w-3.5" />,
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
      label: "Copy source path",
      icon: <Copy className="h-3.5 w-3.5" />,
      onSelect: () => void copyPath(session.path),
    },
    {
      label: revealLabel,
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      onSelect: () => void revealLocation(session.path, session.title),
    },
    {
      label: "Delete session",
      icon: <Trash className="h-3.5 w-3.5" />,
      danger: true,
      disabled: !session.deletable,
      hint: session.deletable ? undefined : "Read-only",
      onSelect: () => openDialog({ kind: "delete-sessions", ids: [session.id] }),
    },
  ];

  const latest = backups[0] ?? null;

  return (
    <PageScroll>
      <PageHeader
        title="Manage"
        subtitle="Export or clean up sessions in bulk. Sessions inside an app's database are never removed."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<Archive className="h-3.5 w-3.5" />}
              onClick={() => openDialog({ kind: "create-backup" })}
            >
              Back up first
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowsClockwise className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
              onClick={() => void rescan()}
            >
              Rescan
            </Button>
          </>
        }
      />

      <div className="mb-3.5 grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-line/[0.065] bg-line/[0.065] lg:grid-cols-4">
        <ManageMeta icon={<Database className="h-4 w-4" />} label="Indexed" value={`${number(sessions.length)} sessions`} detail={`${AGENT_ORDER.filter((id) => sessions.some((s) => s.agent === id)).length} agents`} />
        <ManageMeta icon={<HardDrives className="h-4 w-4" />} label="On disk" value={bytes(totalSize)} detail="original files" />
        <ManageMeta icon={<Archive className="h-4 w-4" />} label="Last backup" value={latest ? relativeTime(latest.createdAt) : "None yet"} detail={latest ? latest.name : "Back up before deleting"} />
        <ManageMeta icon={<ShieldCheck className="h-4 w-4 text-success" />} label="Deletion" value="Path-checked" detail="Agent files only" />
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card min-w-0 overflow-hidden xl:col-span-8">
          <div className="border-b border-line/[0.065] p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={SESSION_SEARCH_PLACEHOLDER}
                shortcut=""
                className="h-9 w-full basis-full rounded-[12px] bg-sunken/45 px-3 shadow-none"
              />
              <div className="relative">
                <select
                  value={agent}
                  onChange={(event) => setAgent(event.target.value as AgentId | "all")}
                  aria-label="Filter by agent"
                  className="h-9 cursor-pointer appearance-none rounded-full border border-line/[0.08] bg-panel pl-3 pr-8 text-12 font-medium text-fg outline-none transition-colors hover:bg-sunken/50"
                >
                  <option value="all">All agents</option>
                  {AGENT_ORDER.map((id) => (
                    <option key={id} value={id}>
                      {AGENTS[id].name}
                    </option>
                  ))}
                </select>
                <CaretDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              </div>
              <div className="relative">
                <select
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                  aria-label="Filter by project"
                  className="h-9 max-w-[180px] cursor-pointer appearance-none truncate rounded-full border border-line/[0.08] bg-panel pl-3 pr-8 text-12 font-medium text-fg outline-none transition-colors hover:bg-sunken/50"
                >
                  <option value="all">All projects</option>
                  {projects.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <CaretDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              </div>
              <div className="relative">
                <select
                  value={age}
                  onChange={(event) => setAge(event.target.value as AgeFilter)}
                  aria-label="Filter by age"
                  className="h-9 cursor-pointer appearance-none rounded-full border border-line/[0.08] bg-panel pl-3 pr-8 text-12 font-medium text-fg outline-none transition-colors hover:bg-sunken/50"
                >
                  <option value="any">Any age</option>
                  <option value="90d">Older than 90 days</option>
                  <option value="6m">Older than 6 months</option>
                </select>
                <CaretDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              </div>
              <div className="relative">
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                  aria-label="Sort"
                  className="h-9 cursor-pointer appearance-none rounded-full border border-line/[0.08] bg-panel pl-3 pr-8 text-12 font-medium text-fg outline-none transition-colors hover:bg-sunken/50"
                >
                  <option value="recent">Most recent</option>
                  <option value="oldest">Oldest first</option>
                  <option value="largest">Largest files</option>
                  <option value="tokens">Most tokens</option>
                </select>
                <CaretDown className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 px-1 text-11 text-faint">
              <span>
                {number(filtered.length)} {filtered.length === 1 ? "session" : "sessions"}
                {filtered.length !== sessions.length ? ` of ${number(sessions.length)}` : ""}
              </span>
              <span className="flex items-center gap-2">
                {latest ? (
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-success-solid" />
                    Backup {relativeTime(latest.createdAt)}
                  </span>
                ) : (
                  <span className="text-warning">No backup yet</span>
                )}
              </span>
            </div>
          </div>

          {selectedSessions.length > 0 && (
            <motion.div
              initial={false}
              animate={{ opacity: 1, height: "auto" }}
              className="overflow-hidden border-b border-copper-500/15 bg-copper-500/[0.06]"
            >
              <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-11 font-medium text-fg">
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-copper-500 px-1.5 text-11 font-bold tabular text-white">
                    {selectedSessions.length}
                  </span>
                  selected
                  <span className="text-11 font-normal text-muted">
                    {bytes(selectedSize)} · {number(selectedDeletable.length)} removable
                  </span>
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2.5 text-11"
                    icon={<Export className="h-3 w-3" />}
                    onClick={() =>
                      openDialog({ kind: "export-sessions", ids: selectedSessions.map((s) => s.id) })
                    }
                  >
                    Export
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="h-7 px-2.5 text-11"
                    icon={<Trash className="h-3 w-3" />}
                    disabled={selectedDeletable.length === 0}
                    onClick={() =>
                      openDialog({ kind: "delete-sessions", ids: selectedSessions.map((s) => s.id) })
                    }
                  >
                    Delete
                  </Button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="flex h-7 items-center rounded-full px-2 text-11 font-medium text-muted transition-colors hover:bg-line/[0.055] hover:text-fg"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          <div className="hidden grid-cols-[24px_minmax(0,1fr)_112px_72px_64px_66px_26px] items-center gap-2.5 border-b border-line/[0.06] bg-sunken/25 px-3.5 py-2 text-11 font-medium text-faint lg:grid">
            <Checkbox
              checked={allPageSelected}
              indeterminate={!allPageSelected && somePageSelected}
              onChange={togglePage}
              label="Select this page"
            />
            <span>Session</span>
            <span>Agent</span>
            <span>Updated</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Size</span>
            <span />
          </div>

          <div className="divide-y divide-line/[0.05]">
            {pageItems.map((session) => {
              const isSelected = selected.has(session.id);
              const Icon = projectIcon(session.icon);
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleOne(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleOne(session.id);
                    }
                  }}
                  className={cn(
                    "group grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_26px] items-center gap-2.5 px-3.5 py-2.5 outline-none transition-colors lg:grid-cols-[24px_minmax(0,1fr)_112px_72px_64px_66px_26px]",
                    isSelected ? "bg-copper-500/[0.045]" : "hover:bg-sunken/35",
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onChange={() => toggleOne(session.id)}
                    label={`Select ${session.title}`}
                  />
                  <div className="flex min-w-0 items-center gap-2.5">
                    <SessionGlyph agent={session.agent} icon={Icon} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-12 font-semibold tracking-[-0.01em] text-fg/90">
                        {session.title}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-11 text-faint">
                        <span className="truncate">{session.projectLabel}</span>
                        <span className="h-[2.5px] w-[2.5px] shrink-0 rounded-full bg-faint/40" />
                        <span className="truncate font-mono">{session.format.toUpperCase()}</span>
                        {!session.deletable && (
                          <span className="hidden shrink-0 rounded-full bg-line/[0.06] px-1.5 py-px text-11 text-faint sm:inline">
                            read-only
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="hidden lg:block">
                    <AgentBadge agent={session.agent} compact />
                  </div>
                  <div className="hidden text-11 text-muted lg:block">
                    {relativeTime(session.updatedAt)}
                  </div>
                  <div className="hidden text-right text-11 tabular text-muted lg:block">
                    {session.usage ? compact(session.tokens) : "—"}
                  </div>
                  <div className="hidden text-right text-11 tabular text-muted lg:block">
                    {bytes(session.sizeBytes)}
                  </div>
                  <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                    <KebabMenu items={rowMenu(session)} label={`Actions for ${session.title}`} />
                  </div>
                </div>
              );
            })}

            {pageItems.length === 0 && (
              <EmptyState
                icon={<MagnifyingGlass className="h-5 w-5" />}
                title="No sessions match"
                description="Try clearing the search, agent, or age filter."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setAgent("all");
                      setAge("any");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line/[0.06] px-3.5 py-2.5">
            <span className="text-11 text-faint">
              {filtered.length === 0
                ? "No results"
                : `${number(safePage * PAGE_SIZE + 1)}–${number(
                    Math.min(filtered.length, (safePage + 1) * PAGE_SIZE),
                  )} of ${number(filtered.length)}`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                aria-label="Previous page"
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-line/[0.055] hover:text-fg disabled:pointer-events-none disabled:opacity-30"
              >
                <CaretLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[60px] text-center text-11 tabular text-muted">
                {safePage + 1} / {pages}
              </span>
              <button
                type="button"
                disabled={safePage >= pages - 1}
                onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
                aria-label="Next page"
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-line/[0.055] hover:text-fg disabled:pointer-events-none disabled:opacity-30"
              >
                <CaretRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-3.5 self-start xl:col-span-4">
          <div className="card p-[18px]">
            <div className="flex items-center justify-between">
              <h2 className="text-13 font-bold tracking-[-0.02em]">Storage by agent</h2>
              <span className="text-11 tabular text-faint">{bytes(totalSize)}</span>
            </div>
            <div className="mt-3 space-y-3">
              {agentStorage.map((item) => (
                <div key={item.id}>
                  <div className="flex items-center gap-2">
                    <span className={`${AGENT_CLASS[item.id]} text-[var(--agent)]`}>
                      <AgentMark agent={item.id} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-11 font-medium text-fg/85">
                        {AGENTS[item.id].name}
                      </span>
                      <span className="block truncate font-mono text-11 text-faint">
                        {item.root}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-11 font-medium tabular text-muted">
                        {bytes(item.size)}
                      </span>
                      <span className="block text-11 tabular text-faint">
                        {number(item.sessions)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void revealLocation(item.root, AGENTS[item.id].name)}
                      aria-label={`Reveal ${AGENTS[item.id].name} storage`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-line/[0.055] hover:text-fg"
                    >
                      <FolderOpen className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line/[0.055]">
                    <motion.span
                      initial={false}
                      animate={{ width: `${item.share}%` }}
                      transition={{ duration: 0.12 }}
                      className="block h-full rounded-full"
                      style={{ backgroundColor: AGENTS[item.id].accent }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[20px] bg-[var(--rail)] p-[18px] text-[#f3ebde] dark:border dark:border-white/[0.055] dark:bg-[var(--rail-elevated)]">
            <div className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-[0.12em] text-[#f3ebde]/32">
              <ShieldCheck className="h-3 w-3 text-[#d18a5d]" />
              Safe deletion
            </div>
            <h3 className="mt-2 text-16 font-bold leading-[1.15] tracking-[-0.03em]">
              Nothing outside your agents is touched.
            </h3>
            <p className="mt-2 text-11 leading-[1.65] text-[#f3ebde]/42">
              Every path is resolved and checked against a discovered agent root. Sessions kept in
              another app's database (Cursor, OpenCode, Antigravity) are exported, never removed.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-11 text-[#f3ebde]/55">
                Path validation
              </span>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-11 text-[#f3ebde]/55">
                Explicit confirmation
              </span>
            </div>
          </div>

          <div className="card p-[18px]">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-line/[0.045] text-muted">
                <Archive className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-11 font-semibold text-fg/85">
                  {latest ? latest.name : "No backup yet"}
                </div>
                <div className="text-11 text-faint">
                  {latest
                    ? `${relativeTime(latest.createdAt)} · ${bytes(latest.sizeBytes)}`
                    : "Protect the library before cleaning up"}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <Button
                variant="copper"
                size="sm"
                className="h-7 flex-1 px-2 text-11"
                icon={<Archive className="h-3 w-3" />}
                onClick={() => openDialog({ kind: "create-backup" })}
              >
                Create backup
              </Button>
              {latest && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 px-2 text-11"
                  onClick={() => openDialog({ kind: "backup-details", id: latest.id })}
                >
                  View
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 px-1 text-11 leading-relaxed text-faint">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            {demo
              ? "Preview deletions update the sample library only; real files on your device are untouched."
              : `Deleted sessions move to your ${trashName()}, where you can put them back until it is emptied.`}
          </div>
        </aside>
      </div>
    </PageScroll>
  );
}

function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className={cn(
        "flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150",
        checked || indeterminate
          ? "border-copper-500 bg-copper-500 text-white"
          : "border-line/20 bg-panel hover:border-line/35",
      )}
    >
      {indeterminate ? (
        <Minus className="h-2.5 w-2.5" weight="bold" />
      ) : checked ? (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
          <path d="M2.4 6.2l2.1 2.2 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

function ManageMeta({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 bg-panel px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-line/[0.045] text-muted">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-11 font-medium text-faint">{label}</div>
        <div className="mt-0.5 truncate text-13 font-bold tabular tracking-[-0.02em] text-fg">{value}</div>
        <div className="truncate text-11 text-faint" title={detail}>{detail}</div>
      </div>
    </div>
  );
}
