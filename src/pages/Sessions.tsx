import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowsInSimple,
  ArrowsOutSimple,
  CalendarBlank,
  CaretDown,
  ChatCircleDots,
  Clock,
  Copy,
  Database,
  Export,
  FileText,
  FolderOpen,
  GitBranch,
  Hash,
  MagnifyingGlass,
  Coins,
  Cpu,
  Terminal,
  Trash,
  WarningCircle,
  X,
  Wrench,
} from "@phosphor-icons/react";
import { AGENT_CLASS, AGENTS, AGENT_ORDER, TINT_CLASS } from "../lib/agents";
import { platform } from "../lib/native";
import { usageTokens } from "../lib/pricing";
import { parseBlocks } from "../lib/markdown";
import { matchesSession, searchTokens, SESSION_SEARCH_PLACEHOLDER } from "../lib/search";
import { useApp } from "../lib/store";
import type { AgentId, Message, SessionDetail, SessionSummary } from "../lib/types";
import {
  bytes,
  clock,
  cn,
  compact,
  duration,
  fullDate,
  money,
  number,
  relativeTime,
  shortDate,
} from "../lib/utils";
import { AgentMark, BrandMark } from "../components/Brand";
import { projectIcon } from "../components/icons";
import {
  AgentBadge,
  Button,
  EmptyState,
  IconButton,
  KebabMenu,
  SearchInput,
  Skeleton,
  Tooltip,
} from "../components/ui";

type SortKey = "recent" | "oldest" | "tokens" | "size";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest first" },
  { value: "tokens", label: "Most tokens" },
  { value: "size", label: "Largest files" },
];

// Keep machine-generated context available in the transcript without letting it
// become the label for a conversation.
function sessionTitle(session: SessionSummary): string {
  const title = session.title.trim();
  if (!title || /^(?:<(?:external_codex_apps_open_page|environment_context|user_instructions|permissions|turn_aborted)\b|# AGENTS\.md instructions|the following is the codex agent history|untitled codex session)/i.test(title)) {
    return `${AGENTS[session.agent].shortName} session`;
  }
  return title;
}

// Mirrors `is_injected_context` in src-tauri/src/util.rs for sample data.
const INJECTED_CONTEXT =
  /^(?:<(?:environment_context|user_instructions|permissions|turn_aborted|guardian_tool_descriptions|external_codex_apps_open_page|in-app-browser-context|task-notification|system-reminder|local-command-(?:caveat|stdout|stderr)|command-(?:name|message|args)|instructions)[\s>/]|# AGENTS\.md instructions for|the following is the codex agent history)/i;

function isInternalContext(message: Message): boolean {
  return message.role === "system" || (message.role === "user" && INJECTED_CONTEXT.test(message.content.trim()));
}

const CONTEXT_LABELS: [RegExp, string][] = [
  [/^# AGENTS\.md instructions/i, "Project instructions (AGENTS.md)"],
  [/^<(?:user_instructions|instructions)\b/i, "Custom instructions"],
  [/^<environment_context\b/i, "Environment details"],
  [/^<permissions\b/i, "Permissions"],
  [/^<turn_aborted\b/i, "Turn interrupted"],
  [/^<task-notification\b/i, "Background task update"],
  [/^<(?:command-name|command-message|command-args)\b/i, "Slash command"],
  [/^<local-command-/i, "Command output"],
  [/^<system-reminder\b/i, "System reminder"],
  [/^<guardian_tool_descriptions\b/i, "Tool descriptions"],
  [/^<in-app-browser-context\b/i, "Browser context"],
];

function contextLabel(content: string): string {
  const text = content.trim();
  return CONTEXT_LABELS.find(([pattern]) => pattern.test(text))?.[1] ?? "Session context";
}

export default function SessionsPage() {
  const {
    sessions,
    loading,
    rescan,
    agentFocus,
    focusAgent,
    selectedSessionId,
    openSession,
    detail,
    detailLoading,
    clearSelection,
    openDialog,
    revealLocation,
    copyPath,
    notify,
    settings,
    navigate,
  } = useApp();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [project, setProject] = useState("all");
  const [visible, setVisible] = useState(70);
  const [focusMode, setFocusMode] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [tab, setTab] = useState<"conversation" | "details">("conversation");
  const lastRequested = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const activeAgent = agentFocus;

  useEffect(() => {
    setVisible(70);
  }, [query, activeAgent, sort, project]);

  useEffect(() => {
    setTab("conversation");
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (lastRequested.current === selectedSessionId) return;
    lastRequested.current = selectedSessionId;
    openSession(selectedSessionId);
  }, [openSession, selectedSessionId]);

  useEffect(() => {
    if (!focusMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) map.set(session.project, session.projectLabel);
    return Array.from(map.entries())
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions]);

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: sessions.length };
    for (const agent of AGENT_ORDER) {
      base[agent] = sessions.filter((session) => session.agent === agent).length;
    }
    return base;
  }, [sessions]);

  const filtered = useMemo(() => {
    const tokens = searchTokens(query);
    const matches = sessions.filter((session) => {
      if (activeAgent !== "all" && session.agent !== activeAgent) return false;
      if (project !== "all" && session.project !== project) return false;
      return matchesSession(session, tokens);
    });
    return matches.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case "tokens":
          return b.tokens - a.tokens;
        case "size":
          return b.sizeBytes - a.sizeBytes;
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
  }, [sessions, activeAgent, project, query, sort]);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );
  const activeDetail = detail && detail.id === selectedSessionId ? detail : null;
  const busy = selectedSessionId !== null && !activeDetail && detailLoading;
  const visibleSessions = filtered.slice(0, visible);
  const filterActive = activeAgent !== "all" || project !== "all" || query.trim().length > 0;

  const clearFilters = () => {
    focusAgent("all");
    setProject("all");
    setQuery("");
  };

  const revealLabel = platform() === "windows" ? "Show in Explorer" : "Reveal in Finder";

  const sessionMenu = (session: SessionSummary) => [
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

  const copyTranscript = async () => {
    if (!activeDetail) return;
    const text = activeDetail.messages
      .map((message) => {
        const who =
          message.role === "user"
            ? "You"
            : message.role === "assistant"
              ? AGENTS[activeDetail.agent].name
              : message.role === "tool"
                ? `Tool · ${message.toolName ?? "Call"}`
                : "System";
        return `${who}\n${message.content}\n`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(`# ${activeDetail.title}\n\n${text}`);
      notify("Transcript copied", `${activeDetail.messages.length} messages on the clipboard.`);
    } catch {
      notify("Couldn't copy transcript", "Clipboard access was blocked by the browser.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-5 pt-1.5 sm:px-5 xl:px-6">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="shrink-0 text-28 font-bold leading-tight tracking-[-0.03em] text-fg">
            Sessions
          </h1>
          <span className="shrink-0 rounded-full border border-line/[0.09] bg-panel px-2.5 py-0.5 text-12 font-medium tabular text-muted">
            {number(sessions.length)}
          </span>
          <p className="hidden min-w-0 truncate text-13 text-muted lg:block">
            Find a conversation and read it in full.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            onClick={() => navigate("manage")}
          >
            Manage storage
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowClockwise className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
            onClick={() => void rescan()}
          >
            Rescan
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3.5">
        <aside
          className={cn(
            "card flex min-h-0 w-full shrink-0 flex-col overflow-hidden lg:w-[320px] xl:w-[340px]",
            focusMode && "hidden",
            mobileDetail ? "hidden lg:flex" : "flex",
          )}
        >
          <div className="shrink-0 space-y-2.5 border-b border-line/[0.065] p-3">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={SESSION_SEARCH_PLACEHOLDER}
              shortcut=""
              className="h-9 rounded-[12px] bg-sunken/45 px-3 text-12 shadow-none"
            />

            <div className="relative">
              <select
                value={activeAgent}
                onChange={(event) => focusAgent(event.target.value as AgentId | "all")}
                aria-label="Filter by agent"
                className="h-9 w-full cursor-pointer appearance-none rounded-[10px] border border-line/[0.08] bg-panel pl-3 pr-8 text-12 text-fg outline-none hover:bg-sunken/50"
              >
                <option value="all">All agents ({counts.all})</option>
                {AGENT_ORDER.map((agent) => (
                  <option key={agent} value={agent}>{AGENTS[agent].shortName} ({counts[agent]})</option>
                ))}
              </select>
              <CaretDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            </div>

            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <select
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                  aria-label="Filter by project"
                  className="h-8 w-full cursor-pointer appearance-none rounded-[10px] border border-line/[0.08] bg-panel pl-3 pr-7 text-12 font-medium text-fg outline-none transition-colors hover:bg-sunken/50"
                >
                  <option value="all">All projects</option>
                  {projects.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <CaretDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              </div>
              <div className="relative min-w-0 flex-1">
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                  aria-label="Sort sessions"
                  className="h-8 w-full cursor-pointer appearance-none rounded-[10px] border border-line/[0.08] bg-panel pl-3 pr-7 text-12 font-medium text-fg outline-none transition-colors hover:bg-sunken/50"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <CaretDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
              </div>
            </div>

            <div className="flex items-center justify-between px-1 text-12 text-faint">
              <span>
                {number(filtered.length)} {filtered.length === 1 ? "session" : "sessions"}
                {filterActive ? " match" : ""}
              </span>
              {filterActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex items-center gap-1 font-medium text-copper-600 transition-colors hover:text-copper-700 dark:text-copper-300 dark:hover:text-copper-200"
                >
                  <X className="h-2.5 w-2.5" />
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {visibleSessions.map((session) => {
              const isSelected = session.id === selectedSessionId;
              return (
                <motion.button
                  key={session.id}
                  type="button"
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.12 }}
                  onClick={() => {
                    openSession(session.id);
                    setMobileDetail(true);
                  }}
                  className={cn(
                    "group relative mb-0.5 flex w-full items-start gap-2.5 rounded-[14px] px-2.5 py-2.5 text-left outline-none transition-colors duration-200",
                    isSelected
                      ? "bg-sunken/90 ring-1 ring-inset ring-line/[0.055]"
                      : "hover:bg-sunken/45 focus-visible:bg-sunken/45",
                  )}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-[calc(50%-12px)] h-6 w-[2.5px] rounded-r-full bg-copper-500" />
                  )}
                  <span className={cn(AGENT_CLASS[session.agent], "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--agent-soft)] text-[var(--agent-ink)]")}>
                    <AgentMark agent={session.agent} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-1.5">
                      <span className="line-clamp-2 min-w-0 flex-1 break-words text-12 font-semibold leading-snug tracking-[-0.01em] text-fg">
                        {sessionTitle(session)}
                      </span>
                      <span className="shrink-0 pt-0.5 text-12 tabular text-faint">
                        {relativeTime(session.updatedAt)}
                      </span>
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-12 text-muted">
                      <span className="truncate">{session.projectLabel}</span>
                      <span className="ml-auto shrink-0 tabular text-faint">
                        {session.usage ? compact(session.tokens) : "—"}
                      </span>
                    </span>
                    {sessionTitle(session) === `${AGENTS[session.agent].shortName} session` && session.excerpt && !/^(?:[<{]|the following is the codex agent history)/i.test(session.excerpt.trim()) && (
                      <span className="mt-1 block truncate text-12 text-muted">{session.excerpt}</span>
                    )}
                  </span>
                </motion.button>
              );
            })}

            {filtered.length === 0 && (
              <EmptyState
                icon={<MagnifyingGlass className="h-5 w-5" />}
                title="No matching sessions"
                description="Try a shorter query, another project, or clear the agent filter."
                action={
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
                className="py-10"
              />
            )}

            {visibleSessions.length < filtered.length && (
              <div className="p-2">
                <Button
                  variant="soft"
                  size="sm"
                  className="w-full"
                  onClick={() => setVisible((count) => count + 90)}
                >
                  Load {Math.min(90, filtered.length - visibleSessions.length)} more
                </Button>
              </div>
            )}
          </div>
        </aside>

        <section
          className={cn(
            "card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            mobileDetail ? "flex" : "hidden lg:flex",
          )}
        >
          {!selected ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<ChatCircleDots className="h-5 w-5" />}
                title="Choose a conversation"
                description="Pick a session from the library to read the full transcript, inspect its metadata, or export a copy."
              />
            </div>
          ) : busy ? (
            <DetailSkeleton
              session={selected}
              onBack={() => setMobileDetail(false)}
              onClear={() => {
                clearSelection();
                setMobileDetail(false);
              }}
            />
          ) : !activeDetail ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<WarningCircle className="h-5 w-5" />}
                title="Couldn't load this conversation"
                description="The source file may have moved or the agent may still be writing it. Rescan the library and try again."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void rescan()}>
                    Rescan library
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <header className="shrink-0 border-b border-line/[0.065] px-5 pb-0 pt-4 sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMobileDetail(false)}
                      aria-label="Back to session list"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-line/[0.05] hover:text-fg lg:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <AgentBadge agent={activeDetail.agent} />
                    <span className="hidden h-3.5 w-px bg-line/[0.1] sm:block" />
                    <span className="hidden truncate text-12 text-muted sm:block">
                      {activeDetail.projectLabel}
                    </span>
                    {activeDetail.branch && (
                      <span className="hidden items-center gap-1 rounded-full bg-line/[0.045] px-2 py-0.5 text-12 text-muted xl:flex">
                        <GitBranch className="h-2.5 w-2.5" />
                        {activeDetail.branch}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip label={focusMode ? "Exit focus mode" : "Focus mode"} side="bottom">
                      <button
                        type="button"
                        onClick={() => setFocusMode((value) => !value)}
                        aria-label={focusMode ? "Exit focus mode" : "Focus mode"}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                          focusMode
                            ? "bg-fg text-canvas"
                            : "text-faint hover:bg-line/[0.055] hover:text-fg",
                        )}
                      >
                        {focusMode ? (
                          <ArrowsInSimple className="h-4 w-4" />
                        ) : (
                          <ArrowsOutSimple className="h-4 w-4" />
                        )}
                      </button>
                    </Tooltip>
                    <KebabMenu
                      items={sessionMenu(activeDetail)}
                      label={`Actions for ${activeDetail.title}`}
                    />
                  </div>
                </div>

                <h2 className="mt-2 flex items-center gap-2 text-18 font-bold leading-snug tracking-[-0.025em] text-fg">
                  <span className="min-w-0 line-clamp-2 break-words">{sessionTitle(activeDetail)}</span>
                </h2>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-12 text-muted">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-faint" />
                    {fullDate(activeDetail.updatedAt)}
                  </span>
                  <Dot />
                  <span>{number(activeDetail.messages.length)} messages</span>

                  {activeDetail.usage && (
                    <>
                      <Dot />
                      <span className="tabular">{compact(activeDetail.tokens)} tokens</span>
                      {settings.showCosts && activeDetail.usage.cost !== null && (
                        <>
                          <Dot />
                          <span className="inline-flex items-center gap-1 rounded-full bg-copper-500/[0.08] px-2 py-0.5 text-12 font-medium text-copper-700 dark:text-copper-300">
                            <Coins className="h-2.5 w-2.5" />≈ {money(activeDetail.usage.cost)}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>

                <div className="no-scrollbar mt-3 flex items-end gap-1 overflow-x-auto">
                  <TabButton
                    active={tab === "conversation"}
                    onClick={() => setTab("conversation")}
                    icon={<ChatCircleDots className="h-3.5 w-3.5" />}
                  >
                    Conversation
                  </TabButton>
                  <TabButton
                    active={tab === "details"}
                    onClick={() => setTab("details")}
                    icon={<FileText className="h-3.5 w-3.5" />}
                  >
                    Details
                  </TabButton>
                  <div className="ml-auto flex items-center pb-1.5">
                    <IconButton icon={<Copy className="h-4 w-4" />} label="Copy transcript" onClick={copyTranscript} tooltipSide="bottom" />
                  </div>
                </div>
              </header>

              <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto">
                {tab === "conversation" ? (
                  <Transcript detail={activeDetail} scrollRoot={transcriptRef} />
                ) : (
                  <DetailsPanel
                    detail={activeDetail}
                    showCosts={settings.showCosts}
                    onExport={() => openDialog({ kind: "export-sessions", ids: [activeDetail.id] })}
                    onReveal={() => void revealLocation(activeDetail.path, activeDetail.title)}
                    onCopyPath={() => void copyPath(activeDetail.path)}
                    onDelete={() =>
                      openDialog({ kind: "delete-sessions", ids: [activeDetail.id] })
                    }
                  />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-[2.5px] w-[2.5px] rounded-full bg-faint/45" />;
}

function TabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative flex items-center gap-1.5 px-2.5 pb-2.5 pt-1 text-12 font-medium transition-colors",
        active ? "text-fg" : "text-faint hover:text-muted",
      )}
    >
      {icon}
      {children}
      {active && (
        <motion.span
          layoutId="session-tab"
          transition={{ type: "spring", stiffness: 480, damping: 36 }}
          className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-fg"
        />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Transcript                                                          */
/* ------------------------------------------------------------------ */

const TRANSCRIPT_BATCH = 120;

function Transcript({
  detail,
  scrollRoot,
}: {
  detail: SessionDetail;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
}) {
  // Long sessions can hold thousands of messages. Render them in batches as the
  // reader scrolls instead of mounting everything at once.
  const [count, setCount] = useState(TRANSCRIPT_BATCH);
  const sentinel = useRef<HTMLDivElement>(null);
  const total = detail.messages.length;

  useEffect(() => {
    setCount(TRANSCRIPT_BATCH);
    scrollRoot.current?.scrollTo({ top: 0 });
  }, [detail.id, scrollRoot]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || count >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((current) => Math.min(total, current + TRANSCRIPT_BATCH));
        }
      },
      { root: scrollRoot.current, rootMargin: "1200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [count, total, scrollRoot]);

  const items = useMemo(
    () => groupTranscript(detail.messages.slice(0, count)),
    [detail.messages, count],
  );

  const remaining = total - count;

  return (
    <div className="mx-auto w-full max-w-[780px] px-5 py-5 sm:px-8 sm:py-6">
      <div className="flex flex-col">
        {items.map((item) => (
          <div key={item.key} className="transcript-row">
            {item.showDay && (
              <div className="my-5 flex items-center gap-3 first:mt-0">
                <span className="text-12 font-medium uppercase tracking-[0.12em] text-faint">
                  {new Date(item.timestamp).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="h-px flex-1 bg-line/[0.06]" />
              </div>
            )}
            {item.kind === "tools" ? (
              <ToolGroup steps={item.steps} />
            ) : (
              <MessageBubble message={item.message} detail={detail} />
            )}
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <div ref={sentinel} className="flex justify-center py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCount((current) => Math.min(total, current + TRANSCRIPT_BATCH))}
          >
            Show {number(Math.min(remaining, TRANSCRIPT_BATCH))} more of {number(remaining)} messages
          </Button>
        </div>
      )}
    </div>
  );
}

type ToolStep = { call: Message | null; result: Message | null };

type TranscriptItem = { key: string; timestamp: string; showDay: boolean } & (
  | { kind: "message"; message: Message }
  | { kind: "tools"; steps: ToolStep[] }
);

const RESULT_DETAILS = new Set(["Tool call completed", "Tool call failed"]);

function isToolResult(message: Message): boolean {
  return message.id.includes("-result-") || RESULT_DETAILS.has(message.toolDetail ?? "");
}

/**
 * Folds each run of consecutive tool messages into one group, and pairs every
 * tool result with the call that produced it.
 */
function groupTranscript(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let lastDay = "";
  let group: Extract<TranscriptItem, { kind: "tools" }> | null = null;

  for (const message of messages) {
    const day = new Date(message.timestamp).toDateString();
    const newDay = day !== lastDay;
    lastDay = day;

    if (message.role !== "tool") {
      group = null;
      items.push({ kind: "message", key: message.id, timestamp: message.timestamp, showDay: newDay, message });
      continue;
    }

    if (!group || newDay) {
      group = { kind: "tools", key: message.id, timestamp: message.timestamp, showDay: newDay, steps: [] };
      items.push(group);
    }

    if (isToolResult(message)) {
      const open = group.steps.find(
        (step) => step.call && !step.result && step.call.toolName === message.toolName,
      );
      if (open) open.result = message;
      else group.steps.push({ call: null, result: message });
    } else {
      group.steps.push({ call: message, result: null });
    }
  }
  return items;
}

/** `mcp__server__update_plan` reads as "Update plan"; plain names stay as they are. */
function toolLabel(name: string | undefined): string {
  if (!name) return "Tool";
  if (!name.startsWith("mcp__")) return name;
  const tail = name.split("__").pop() || name;
  const words = tail.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function stepName(step: ToolStep): string {
  return toolLabel(step.call?.toolName ?? step.result?.toolName);
}

function stepFailed(step: ToolStep): boolean {
  return step.result?.toolStatus === "error" || step.call?.toolStatus === "error";
}

function summarizeNames(steps: ToolStep[]): string {
  const counts = new Map<string, number>();
  for (const step of steps) counts.set(stepName(step), (counts.get(stepName(step)) ?? 0) + 1);
  const parts = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  return parts.length > 4 ? `${parts.slice(0, 4).join(", ")} +${parts.length - 4}` : parts.join(", ");
}

function ToolGroup({ steps }: { steps: ToolStep[] }) {
  if (steps.length === 1) {
    return (
      <div className="my-1.5 ml-10 sm:ml-[38px]">
        <ToolStepRow step={steps[0]} />
      </div>
    );
  }
  const failures = steps.filter(stepFailed).length;
  return (
    <details className="group/tools my-1.5 ml-10 sm:ml-[38px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[8px] px-2 py-1.5 text-12 text-muted transition-colors hover:bg-line/[0.04] hover:text-fg [&::-webkit-details-marker]:hidden">
        <CaretDown className="h-3 w-3 shrink-0 -rotate-90 transition-transform group-open/tools:rotate-0" />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-faint" />
        <span className="shrink-0 font-medium">{steps.length} tool calls</span>
        <span className="truncate text-faint">{summarizeNames(steps)}</span>
        {failures > 0 && (
          <span className="ml-auto shrink-0 text-[#b3543f]">{failures} failed</span>
        )}
      </summary>
      <div className="ml-[13px] mt-0.5 border-l border-line/[0.08] pl-2.5">
        {steps.map((step, index) => (
          <ToolStepRow key={(step.call ?? step.result)?.id ?? index} step={step} />
        ))}
      </div>
    </details>
  );
}

function ToolStepRow({ step }: { step: ToolStep }) {
  const failed = stepFailed(step);
  const detail = step.call?.toolDetail;
  return (
    <details className="group/step">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[8px] px-2 py-1.5 text-12 text-muted transition-colors hover:bg-line/[0.04] hover:text-fg [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            failed ? "bg-[#c4664f]" : step.result ? "bg-[#81976a]" : "bg-line/25",
          )}
        />
        <span className="shrink-0 font-medium text-fg/80">{stepName(step)}</span>
        {detail && <span className="truncate font-mono text-11 text-faint">{detail}</span>}
        {failed && <span className="ml-auto shrink-0 text-[#b3543f]">Failed</span>}
      </summary>
      <div className="mb-1.5 ml-2 space-y-1.5 rounded-[10px] border border-line/[0.07] bg-sunken/30 p-2.5">
        {step.call && <ToolPayload label="Input" content={step.call.content} />}
        {step.result && <ToolPayload label="Output" content={step.result.content} />}
      </div>
    </details>
  );
}

function ToolPayload({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <div className="text-11 font-medium text-faint">{label}</div>
      <pre className="mt-1 max-h-[320px] select-text overflow-auto whitespace-pre-wrap break-words font-mono text-12 leading-relaxed text-muted">
        {content}
      </pre>
    </div>
  );
}

function MessageBubble({ message, detail }: { message: Message; detail: SessionDetail }) {
  if (isInternalContext(message)) {
    return (
      <details className="group my-2 ml-10 rounded-[10px] border border-line/[0.07] bg-sunken/30 text-muted sm:ml-[46px]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-12 font-medium hover:text-fg">
          <CaretDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" />
          <span>{contextLabel(message.content)}</span>
          <span className="font-normal text-faint">Added by {AGENTS[detail.agent].shortName}</span>
        </summary>
        <pre className="select-text whitespace-pre-wrap break-words border-t border-line/[0.055] px-3 py-2.5 font-mono text-12 leading-relaxed text-muted">{message.content}</pre>
      </details>
    );
  }

  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const name = isUser ? "You" : isSystem ? "System" : AGENTS[detail.agent].name;

  return (
    <div className="group flex gap-3 py-2.5">
      <div className="flex w-7 shrink-0 justify-center pt-0.5">
        {isUser ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fg text-12 font-bold text-canvas">
            Y
          </span>
        ) : isSystem ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-line/[0.06] text-faint">
            <WarningCircle className="h-3 w-3" />
          </span>
        ) : (
          <span
            className={`${AGENT_CLASS[detail.agent]} flex h-6 w-6 items-center justify-center rounded-[7px] bg-[var(--agent-soft)] text-[var(--agent-ink)]`}
          >
            <AgentMark agent={detail.agent} className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 pb-1">
          <span className="text-12 font-semibold tracking-[-0.01em] text-fg/85">{name}</span>
          {message.model && !isUser && (
            <span className="hidden truncate rounded-full bg-line/[0.045] px-1.5 py-0.5 font-mono text-11 text-faint sm:inline">
              {message.model}
            </span>
          )}
          <span className="text-12 text-faint">{clock(message.timestamp)}</span>
          {message.tokens !== undefined && (
            <span className="ml-auto text-12 tabular text-faint opacity-0 transition-opacity group-hover:opacity-100">
              {compact(message.tokens)} tok
            </span>
          )}
        </div>

        {isUser ? (
          <div className="rounded-[4px_15px_15px_15px] border border-line/[0.055] bg-sunken/55 px-3.5 py-2.5">
            <RichText content={message.content} />
          </div>
        ) : (
          <div className="px-0.5">
            <RichText content={message.content} />
          </div>
        )}
      </div>
    </div>
  );
}

function RichText({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  return (
    <div className="prose-den">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "code":
            return (
              <pre key={index} data-lang={block.lang || undefined}>
                <code>{block.text}</code>
              </pre>
            );
          case "heading":
            return block.level <= 2 ? (
              <h3 key={index}>{inline(block.text)}</h3>
            ) : (
              <h4 key={index}>{inline(block.text)}</h4>
            );
          case "list":
            return block.ordered ? (
              <ol key={index} start={block.start}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </ol>
            ) : (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </ul>
            );
          case "quote":
            return <blockquote key={index}>{inline(block.text)}</blockquote>;
          case "rule":
            return <hr key={index} />;
          case "table":
            return (
              <div key={index} className="prose-table">
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={cellIndex}>{inline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{inline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={index}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}

// No lookbehind here: older macOS WebKit builds can't parse it.
const INLINE = /`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_/g;

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = "";
  let cursor = 0;
  const pushPlain = () => {
    if (plain) nodes.push(<span key={nodes.length}>{plain}</span>);
    plain = "";
  };
  INLINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE.exec(text))) {
    const part = match[0];
    const start = match.index;
    const end = start + part.length;
    const single = (part[0] === "*" || part[0] === "_") && part[1] !== part[0];
    // `snake_case` and `2*3*4` are not emphasis.
    if (single && (/\w/.test(text[start - 1] ?? "") || /\w/.test(text[end] ?? ""))) {
      INLINE.lastIndex = start + 1;
      continue;
    }
    plain += text.slice(cursor, start);
    pushPlain();
    const key = nodes.length;
    if (part[0] === "`") {
      nodes.push(<code key={key}>{part.slice(1, -1)}</code>);
    } else if (part.startsWith("**") || part.startsWith("__")) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>);
    } else if (part[0] === "[") {
      const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      // Links are shown, not followed: the app never opens URLs from transcripts.
      nodes.push(
        <span key={key} className="prose-link" title={link?.[2]}>
          {link?.[1] ?? part}
        </span>,
      );
    } else {
      nodes.push(<em key={key}>{part.slice(1, -1)}</em>);
    }
    cursor = end;
  }
  plain += text.slice(cursor);
  pushPlain();
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Details                                                             */
/* ------------------------------------------------------------------ */

function DetailsPanel({
  detail,
  showCosts,
  onExport,
  onReveal,
  onCopyPath,
  onDelete,
}: {
  detail: SessionDetail;
  showCosts: boolean;
  onExport: () => void;
  onReveal: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}) {
  const Icon = projectIcon(detail.icon);
  const usage = detail.usage;
  const total = usage ? usageTokens(usage) || 1 : 1;
  const parts = usage
    ? [
        { label: "Input", value: usage.input, color: "#708d92" },
        { label: "Output", value: usage.output, color: "#b8693f" },
        { label: "Cache read", value: usage.cacheRead, color: "#88956b" },
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-4 px-5 py-5 sm:px-8 sm:py-6">
      <div className={`${TINT_CLASS[detail.tint]} relative overflow-hidden rounded-[20px] bg-[var(--tint-bg)] p-4`}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-white/40 text-[var(--tint-ink)] dark:bg-white/[0.06]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-14 font-bold tracking-[-0.025em] text-[var(--tint-ink)]">
              {detail.projectLabel}
            </div>
            <div className="mt-0.5 break-all font-mono text-12 text-[var(--tint-ink)]/60">
              {detail.cwd}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-white/40 px-2 py-0.5 text-12 font-medium text-[var(--tint-ink)]/75 dark:bg-white/[0.055]">
                {AGENTS[detail.agent].name}
              </span>
              <span className="rounded-full bg-white/40 px-2 py-0.5 font-mono text-12 text-[var(--tint-ink)]/70 dark:bg-white/[0.055]">
                {detail.format.toUpperCase()}
              </span>
              {detail.branch && (
                <span className="flex items-center gap-1 rounded-full bg-white/40 px-2 py-0.5 text-12 text-[var(--tint-ink)]/70 dark:bg-white/[0.055]">
                  <GitBranch className="h-2.5 w-2.5" />
                  {detail.branch}
                </span>
              )}
            </div>
          </div>
        </div>
        <Icon className="pointer-events-none absolute -bottom-4 -right-3 h-[86px] w-[86px] text-[var(--tint-ink)] opacity-[0.055]" />
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Messages" value={number(detail.messages.length)} icon={<ChatCircleDots className="h-3.5 w-3.5" />} />
        <Stat label="Tokens" value={detail.usage ? compact(detail.tokens) : "—"} icon={<Hash className="h-3.5 w-3.5" />} />
        <Stat
          label="Est. cost"
          value={showCosts && usage?.cost !== null && usage ? `≈ ${money(usage.cost)}` : "Hidden"}
          icon={<Coins className="h-3.5 w-3.5" />}
        />
        <Stat label="File size" value={bytes(detail.sizeBytes)} icon={<Database className="h-3.5 w-3.5" />} />
      </div>

      {usage && (
        <section className="rounded-[18px] border border-line/[0.07] bg-panel p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-12 font-semibold text-fg">Token breakdown</h3>
            <span className="text-12 text-faint">{compact(detail.tokens)} total</span>
          </div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-line/[0.055]">
            {parts.map((part) => (
              <span
                key={part.label}
                style={{
                  width: `${(part.value / total) * 100}%`,
                  backgroundColor: part.color,
                }}
                title={`${part.label}: ${number(part.value)}`}
              />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {parts.map((part) => (
              <div key={part.label}>
                <div className="flex items-center gap-1.5 text-12 text-faint">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: part.color }} />
                  {part.label}
                </div>
                <div className="mt-0.5 text-12 font-semibold tabular text-fg/85">
                  {compact(part.value)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-[18px] border border-line/[0.07]">
        <MetaRow icon={<CalendarBlank className="h-3.5 w-3.5" />} label="Created" value={fullDate(detail.createdAt)} />
        <MetaRow icon={<Clock className="h-3.5 w-3.5" />} label="Last message" value={fullDate(detail.updatedAt)} />
        <MetaRow icon={<Clock className="h-3.5 w-3.5" />} label="Duration" value={duration(detail.durationMs)} />
        <MetaRow icon={<Cpu className="h-3.5 w-3.5" />} label="Model" value={detail.model ?? "Not recorded"} mono />
        <MetaRow icon={<ChatCircleDots className="h-3.5 w-3.5" />} label="Agent" value={AGENTS[detail.agent].name} />
        <MetaRow icon={<Database className="h-3.5 w-3.5" />} label="Storage" value={`${AGENTS[detail.agent].storageKind} · ${AGENTS[detail.agent].defaultRoot}`} mono last />
      </section>

      <section className="rounded-[18px] border border-line/[0.07] bg-sunken/30 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-12 font-semibold text-fg">Source file</h3>
          <button
            type="button"
            onClick={onCopyPath}
            className="flex items-center gap-1 text-12 font-medium text-muted transition-colors hover:text-fg"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
        <div className="mt-2 break-all rounded-[10px] border border-line/[0.06] bg-panel/70 px-3 py-2 font-mono text-12 leading-relaxed text-muted">
          {detail.path}
        </div>
        {!detail.deletable && (
          <div className="mt-2.5 flex items-start gap-1.5 text-12 leading-relaxed text-[#8c6a2a] dark:text-[#d2b97d]">
            <WarningCircle className="mt-0.5 h-3 w-3 shrink-0" />
            This session lives inside an agent database. It can be read and exported, but not
            deleted independently.
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2 pb-2">
        <Button variant="secondary" size="sm" icon={<Export className="h-3.5 w-3.5" />} onClick={onExport}>
          Export session
        </Button>
        <Button variant="secondary" size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={onReveal}>
          Open location
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash className="h-3.5 w-3.5" />}
          className="text-[#a84434] hover:bg-[#a84434]/[0.06] dark:text-[#e19b8c]"
          disabled={!detail.deletable}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-line/[0.07] bg-panel px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-12 font-medium text-faint">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 truncate text-13 font-bold tabular tracking-[-0.02em] text-fg">
        {value}
      </div>
    </div>
  );
}

function MetaRow({
  icon,
  label,
  value,
  mono,
  last,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-5 bg-panel px-4 py-2.5",
        !last && "border-b border-line/[0.055]",
      )}
    >
      <span className="flex shrink-0 items-center gap-2 text-12 text-muted">
        <span className="text-faint">{icon}</span>
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 text-right text-12 font-medium text-fg/85",
          mono && "break-all font-mono text-12 text-muted",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function DetailSkeleton({
  session,
  onBack,
  onClear,
}: {
  session: SessionSummary;
  onBack: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line/[0.065] px-6 pb-5 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted lg:hidden"
              aria-label="Back to sessions"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <AgentBadge agent={session.agent} />
            <span className="text-12 text-muted">{session.projectLabel}</span>
          </div>
          <IconButton
            icon={<X className="h-4 w-4" />}
            label="Clear selection"
            onClick={onClear}
            tooltip={false}
          />
        </div>
        <Skeleton className="mt-4 h-7 w-[62%]" />
        <Skeleton className="mt-3 h-3 w-[42%]" />
      </div>
      <div className="space-y-5 p-6">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className={index % 2 === 0 ? "h-16 w-full" : "h-11 w-[86%]"} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
