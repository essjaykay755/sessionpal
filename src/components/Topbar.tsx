import { useEffect, useState } from "react";
import {
  MagnifyingGlass,
  Moon,
  SidebarSimple,
  Sun,
} from "@phosphor-icons/react";
import { useApp } from "../lib/store";
import { platform } from "../lib/native";
import type { PageId } from "../lib/types";
import { cn } from "../lib/utils";
import { IconButton, Kbd, Tooltip } from "./ui";
import { WindowsWindowControls } from "./WindowsWindowControls";

const PAGE_META: Record<PageId, string> = {
  overview: "Overview",
  sessions: "Sessions",
  usage: "Usage & cost",
  backups: "Backups",
  manage: "Manage",
  settings: "Settings",
};

export function Topbar() {
  const {
    page,
    setCommandOpen,
    effectiveTheme,
    toggleTheme,
    demo,
    native,
    loading,
    sessions,
    error,
    openDialog,
    settings,
    toggleSidebar,
  } = useApp();
  const isMac = platform() === "macos";
  const windowsChrome = native && platform() === "windows";
  const mod = isMac ? "⌘" : "Ctrl";
  const scanning = native && loading && sessions.length === 0 && !error;

  const [showPageTitle, setShowPageTitle] = useState(false);
  useEffect(() => {
    setShowPageTitle(false);
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest("main")) return;
      const main = target.closest("main");
      const heading = main?.querySelector("h1");
      if (!main || !heading) return;
      setShowPageTitle(heading.getBoundingClientRect().bottom <= main.getBoundingClientRect().top + 4);
    };
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [page]);

  return (
    <header
      data-tauri-drag-region
      className={cn("relative z-20 flex h-[54px] shrink-0 select-none items-center justify-between gap-4 pl-4 sm:pl-5 xl:pl-6", windowsChrome ? "pr-0" : "pr-4 sm:pr-5 xl:pr-6")}
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-3 self-stretch">
        <div className="hidden lg:block">
          <Tooltip label={settings.sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"} side="bottom">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={settings.sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
              aria-expanded={settings.sidebarExpanded}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-line/[0.06] hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500"
            >
              <SidebarSimple className="h-[18px] w-[18px]" />
            </button>
          </Tooltip>
        </div>
        <span
          data-tauri-drag-region
          aria-hidden={!showPageTitle}
          className={cn("truncate text-14 font-semibold tracking-[-0.015em] text-fg transition-[opacity,transform] duration-150", showPageTitle ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}
        >
          {PAGE_META[page]}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="group hidden h-9 min-w-[218px] items-center gap-2.5 rounded-full border border-line/[0.085] bg-panel/75 px-3.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] transition-all duration-150 ease-silk hover:border-line/[0.16] hover:bg-panel sm:flex xl:min-w-[292px] dark:shadow-none"
          aria-label="Search sessions and actions"
        >
          <MagnifyingGlass className="h-[15px] w-[15px] shrink-0 text-faint transition-colors group-hover:text-muted" />
          <span className="min-w-0 flex-1 truncate text-12 text-faint">
            Jump to a session, page or action…
          </span>
          <Kbd className="shrink-0">{mod} K</Kbd>
        </button>

        <IconButton
          icon={<MagnifyingGlass className="h-4 w-4" />}
          label="Jump to…"
          onClick={() => setCommandOpen(true)}
          className="sm:hidden"
        />

        {(scanning || demo) && (
          <Tooltip label={scanning ? "Reading local session files" : "This preview uses sample data"} side="bottom" delay={380}>
            <button
              type="button"
              onClick={() => openDialog({ kind: "privacy" })}
              className="hidden h-8 items-center gap-2 rounded-full border border-line/[0.1] bg-panel/80 px-2.5 text-11 font-medium text-muted transition-colors hover:bg-sunken/70 md:flex"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", scanning ? "animate-pulse bg-copper-400" : "bg-warning-solid")} />
              {scanning ? "Scanning" : "Sample data"}
            </button>
          </Tooltip>
        )}

        <IconButton
          icon={
            effectiveTheme === "dark" ? (
              <Sun className="h-[17px] w-[17px]" />
            ) : (
              <Moon className="h-[17px] w-[17px]" />
            )
          }
          label={effectiveTheme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}
          onClick={toggleTheme}
          tooltipSide="bottom"
        />
        {windowsChrome && <WindowsWindowControls />}
      </div>
    </header>
  );
}
