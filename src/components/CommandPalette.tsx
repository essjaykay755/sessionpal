import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  ArrowsClockwise,
  ArrowRight,
  ChartLineUp,
  ChatCircleDots,
  HardDrives,
  GearSix,
  MagnifyingGlass,
  Moon,
  ShieldCheck,
  Coins,
  SquaresFour,
  Sun,
  Info,
} from "@phosphor-icons/react";
import { AGENTS, AGENT_CLASS } from "../lib/agents";
import { APP_INFO } from "../lib/about";
import { useApp } from "../lib/store";
import type { PageId } from "../lib/types";
import { cn, compact, relativeTime } from "../lib/utils";
import { AgentMark, BrandMark } from "./Brand";
import { Kbd } from "./ui";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  detail?: string;
  icon: React.ReactNode;
  run: () => void;
  keywords?: string;
}

const PAGE_COMMANDS: Array<{ page: PageId; label: string; detail: string; icon: React.ReactNode }> = [
  { page: "overview", label: "Overview", detail: "Library at a glance", icon: <SquaresFour className="h-4 w-4" /> },
  { page: "sessions", label: "Sessions", detail: "Browse conversations", icon: <ChatCircleDots className="h-4 w-4" /> },
  { page: "usage", label: "Usage & cost", detail: "Tokens and estimates", icon: <ChartLineUp className="h-4 w-4" /> },
  { page: "backups", label: "Backups", detail: "Archives on this device", icon: <Archive className="h-4 w-4" /> },
  { page: "manage", label: "Manage", detail: "Export and clean up", icon: <HardDrives className="h-4 w-4" /> },
  { page: "settings", label: "Settings", detail: "Appearance and storage", icon: <GearSix className="h-4 w-4" /> },
];

export function CommandPalette() {
  const {
    commandOpen,
    setCommandOpen,
    navigate,
    sessions,
    openSession,
    openDialog,
    rescan,
    effectiveTheme,
    updateSettings,
    settings,
    backups,
    demo,
  } = useApp();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!commandOpen) return;
    setQuery("");
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [commandOpen]);

  const needle = query.trim().toLowerCase();

  const commands = useMemo(() => {
    const base: PaletteItem[] = [
      ...PAGE_COMMANDS.map((command) => ({
        id: `page-${command.page}`,
        group: "Navigate",
        label: command.label,
        detail: command.detail,
        icon: command.icon,
        keywords: `go to ${command.label} ${command.page}`,
        run: () => navigate(command.page),
      })),
      {
        id: "create-backup",
        group: "Actions",
        label: "Create a local backup",
        detail: `Zip to disk${backups.length ? ` · ${backups.length} existing` : ""}`,
        icon: <Archive className="h-4 w-4" />,
        keywords: "archive save snapshot zip",
        run: () => openDialog({ kind: "create-backup" }),
      },
      {
        id: "rescan",
        group: "Actions",
        label: "Rescan agent storage",
        detail: demo ? "Refresh sample library" : "Look for new local sessions",
        icon: <ArrowsClockwise className="h-4 w-4" />,
        keywords: "refresh scan discover sync",
        run: () => void rescan(),
      },
      {
        id: "costs",
        group: "Actions",
        label: "How cost estimates work",
        detail: "Public list prices, computed locally",
        icon: <Coins className="h-4 w-4" />,
        keywords: "pricing api money tokens estimate",
        run: () => openDialog({ kind: "explain-costs" }),
      },
      {
        id: "privacy",
        group: "Actions",
        label: "Privacy & local data",
        detail: "What SessionPal reads and never does",
        icon: <ShieldCheck className="h-4 w-4" />,
        keywords: "local offline telemetry cloud privacy",
        run: () => openDialog({ kind: "privacy" }),
      },
      {
        id: "about",
        group: "Actions",
        label: "About SessionPal",
        detail: `Version ${APP_INFO.version} and version history`,
        icon: <Info className="h-4 w-4" />,
        keywords: "about version history changelog release notes what's new developer website",
        run: () => {
          navigate("settings");
          window.setTimeout(
            () => document.getElementById("settings-section-about")?.click(),
            80,
          );
        },
      },
      {
        id: "theme",
        group: "Preferences",
        label: effectiveTheme === "dark" ? "Switch to light appearance" : "Switch to dark appearance",
        detail: "Appearance",
        icon:
          effectiveTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
        keywords: "theme mode colors dark light",
        run: () => updateSettings({ theme: effectiveTheme === "dark" ? "light" : "dark" }),
      },
      {
        id: "costs-toggle",
        group: "Preferences",
        label: settings.showCosts ? "Hide estimated costs" : "Show estimated costs",
        detail: "Keep estimates or hide them",
        icon: <ChartLineUp className="h-4 w-4" />,
        keywords: "money pricing estimate hide show",
        run: () => updateSettings({ showCosts: !settings.showCosts }),
      },
    ];

    if (!needle) return base;
    return base.filter((item) =>
      `${item.label} ${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [
    backups.length,
    demo,
    effectiveTheme,
    navigate,
    openDialog,
    rescan,
    settings.showCosts,
    updateSettings,
    needle,
  ]);

  const sessionResults = useMemo(() => {
    if (!needle) return sessions.slice(0, 5);
    const tokens = needle.split(/\s+/).filter(Boolean);
    return sessions
      .filter((session) => {
        const haystack = `${session.title} ${session.projectLabel} ${session.excerpt} ${AGENTS[session.agent].name} ${session.model ?? ""}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 7);
  }, [needle, sessions]);

  const items: PaletteItem[] = useMemo(
    () => [
      ...commands,
      ...sessionResults.map((session) => ({
        id: `session-${session.id}`,
        group: "Sessions",
        label: session.title,
        detail: `${AGENTS[session.agent].shortName} · ${session.projectLabel} · ${relativeTime(session.updatedAt)}`,
        icon: (
          <span
            className={`${AGENT_CLASS[session.agent]} flex h-6 w-6 items-center justify-center rounded-[8px] bg-[var(--agent-soft)] text-[var(--agent-ink)]`}
          >
            <AgentMark agent={session.agent} className="h-3.5 w-3.5" />
          </span>
        ),
        keywords: session.excerpt,
        run: () => {
          openSession(session.id);
          navigate("sessions");
        },
      })),
    ],
    [commands, navigate, openSession, sessionResults],
  );

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    if (!commandOpen) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, commandOpen]);

  const close = () => setCommandOpen(false);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (items.length ? (index + 1) % items.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (items.length ? (index - 1 + items.length) % items.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) {
        close();
        window.setTimeout(item.run, 40);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  if (typeof document === "undefined") return null;

  let lastGroup = "";

  return createPortal(
    <AnimatePresence>
      {commandOpen && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center px-4 pt-[9vh] sm:pt-[12vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={close}
            className="absolute inset-0 bg-[#16120d]/45 backdrop-blur-[6px] dark:bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onKeyDown={handleKeyDown}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="relative z-10 flex max-h-[min(620px,78dvh)] w-full max-w-[610px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-panel shadow-float dark:border-white/[0.08]"
          >
            <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line/[0.075] px-5">
              <MagnifyingGlass className="h-[18px] w-[18px] shrink-0 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search sessions, jump to a page, or run a command…"
                className="min-w-0 flex-1 bg-transparent text-13 tracking-[-0.01em] text-fg outline-none placeholder:text-faint"
                aria-controls="palette-results"
                aria-autocomplete="list"
              />
              <Kbd>Esc</Kbd>
            </div>

            <div
              ref={listRef}
              id="palette-results"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
              role="listbox"
            >
              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <BrandMark className="h-7 w-7 text-faint/50" />
                  <div className="mt-3 text-13 font-semibold text-fg">
                    Nothing matches “{query}”
                  </div>
                  <div className="mt-1 text-12 text-muted">
                    Try a project name, an agent, or a page.
                  </div>
                </div>
              )}
              {items.map((item, index) => {
                const showGroup = item.group !== lastGroup;
                lastGroup = item.group;
                const active = index === activeIndex;
                return (
                  <div key={item.id}>
                    {showGroup && (
                      <div className="px-2.5 pb-1 pt-3 text-11 font-medium uppercase tracking-[0.14em] text-faint first:pt-1.5">
                        {item.group}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-palette-index={index}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => {
                        close();
                        window.setTimeout(item.run, 30);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors",
                        active ? "bg-line/[0.065] text-fg" : "text-fg/80",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]",
                          active ? "bg-panel text-fg shadow-sm" : "bg-line/[0.045] text-muted",
                        )}
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-13 font-medium tracking-[-0.01em]">
                          {item.label}
                        </span>
                        {item.detail && (
                          <span className="mt-0.5 block truncate text-11 text-muted">
                            {item.detail}
                          </span>
                        )}
                      </span>
                      {active && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-faint" />}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex h-10 shrink-0 items-center justify-between border-t border-line/[0.07] bg-sunken/30 px-4 text-11 text-faint">
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> navigate
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>↵</Kbd> open
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                {!needle && (
                  <>
                    <span>{compact(sessions.length)} sessions</span>
                    <span className="h-[2.5px] w-[2.5px] rounded-full bg-faint/50" />
                  </>
                )}
                <span>Stays on this device</span>
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
