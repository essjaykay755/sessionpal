import { useEffect, useState } from "react";
import {
  MagnifyingGlass,
  Minus,
  Moon,
  Square,
  Sun,
  X,
} from "@phosphor-icons/react";
import { useApp } from "../lib/store";
import { platform } from "../lib/native";
import type { PageId } from "../lib/types";
import { cn } from "../lib/utils";
import { IconButton, Kbd, Tooltip } from "./ui";

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
  } = useApp();
  const isMac = platform() === "macos";
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
      className="relative z-20 flex h-[54px] shrink-0 select-none items-center justify-between gap-4 px-4 sm:px-5 xl:px-6"
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center self-stretch">
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
              <span className={cn("h-1.5 w-1.5 rounded-full", scanning ? "animate-pulse bg-copper-400" : "bg-[#ba8e43]")} />
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
      </div>
    </header>
  );
}
