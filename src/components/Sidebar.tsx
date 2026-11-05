import { useEffect, useState, type ComponentType } from "react";
import { motion } from "motion/react";
import {
  Archive,
  ChartLineUp,
  ChatCircleDots,
  GearSix,
  HardDrives,
  SidebarSimple,
  SquaresFour,
  type IconProps,
} from "@phosphor-icons/react";
import { useApp } from "../lib/store";
import { platform } from "../lib/native";
import type { PageId } from "../lib/types";
import { cn, compact } from "../lib/utils";
import { BrandMark } from "./Brand";
import { Tooltip } from "./ui";

interface NavItem {
  page: PageId;
  label: string;
  icon: ComponentType<IconProps>;
  count?: number;
}

const EXPANDED_WIDTH = 216;
// Wide enough for the macOS window buttons, which sit at the top of the sidebar.
const COLLAPSED_WIDTH = 80;
const NARROW_WINDOW = "(max-width: 1023px)";

function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_WINDOW).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW_WINDOW);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function Sidebar() {
  const { page, navigate, toggleSidebar, settings, backups, sessions, native, loading, error } =
    useApp();
  const narrow = useNarrowWindow();
  const expanded = settings.sidebarExpanded && !narrow;
  const scanning = native && loading && sessions.length === 0 && !error;
  const macWindow = native && platform() === "macos";

  const mainNav: NavItem[] = [
    { page: "overview", label: "Overview", icon: SquaresFour },
    { page: "sessions", label: "Sessions", icon: ChatCircleDots, count: sessions.length },
    { page: "usage", label: "Usage & cost", icon: ChartLineUp },
  ];
  const libraryNav: NavItem[] = [
    { page: "backups", label: "Backups", icon: Archive, count: backups.length },
    { page: "manage", label: "Manage", icon: HardDrives },
  ];

  const renderItem = (item: NavItem) => {
    const active = page === item.page;
    const Icon = item.icon;
    const button = (
      <button
        key={item.page}
        type="button"
        onClick={() => navigate(item.page)}
        disabled={scanning}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-9 w-full items-center gap-2.5 rounded-[10px] text-left transition-colors duration-150 disabled:cursor-default disabled:opacity-40",
          expanded ? "px-2.5" : "justify-center px-0",
          active
            ? "bg-white/[0.085] text-[#f7f0e5]"
            : "text-[#f7f0e5]/55 enabled:hover:bg-white/[0.04] enabled:hover:text-[#f7f0e5]/90",
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" weight={active ? "fill" : "regular"} />
        {expanded && (
          <span className="min-w-0 flex-1 truncate text-13 font-medium tracking-[-0.01em]">
            {item.label}
          </span>
        )}
        {expanded && item.count !== undefined && item.count > 0 && (
          <span className="text-11 tabular text-white/35">{compact(item.count)}</span>
        )}
      </button>
    );
    return expanded ? (
      button
    ) : (
      <Tooltip key={item.page} label={item.label} side="right">
        {button}
      </Tooltip>
    );
  };

  const toggle = (
    <Tooltip label={expanded ? "Hide labels" : "Show labels"} side="right">
      <button
        type="button"
        onClick={toggleSidebar}
        disabled={narrow}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        className="flex h-7 w-7 items-center justify-center rounded-[8px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80 disabled:hidden"
      >
        <SidebarSimple className="h-[17px] w-[17px]" />
      </button>
    </Tooltip>
  );

  return (
    <motion.aside
      initial={false}
      animate={{ width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="relative z-30 flex h-full shrink-0 select-none flex-col overflow-hidden bg-[var(--rail)] text-[#f6efe4]"
    >
      {/* The macOS window buttons sit in this row; the rest of it drags the window. */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-[46px] shrink-0 items-center",
          expanded ? "justify-end px-3" : "justify-center",
        )}
      >
        {expanded && toggle}
      </div>

      <div className={cn("flex items-center gap-2 pb-4", expanded ? "px-4" : "flex-col px-0")}>
        <button
          type="button"
          onClick={() => navigate("overview")}
          disabled={scanning}
          aria-label="SessionPal overview"
          className="flex items-center gap-2 rounded-[8px] text-[#efe2c8] transition-opacity hover:opacity-80"
        >
          <BrandMark className="h-[19px] w-[19px]" />
          {expanded && (
            <span className="text-14 font-bold tracking-[-0.03em] text-[#f6efe4]">SessionPal</span>
          )}
        </button>
        {!expanded && !macWindow && toggle}
        {!expanded && macWindow && <div className="mt-1">{toggle}</div>}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
        {mainNav.map(renderItem)}

        {expanded ? (
          <div className="px-2.5 pb-1.5 pt-5 text-11 font-semibold text-white/30">On this device</div>
        ) : (
          <div className="mx-auto my-3 h-px w-6 bg-white/[0.08]" />
        )}

        {libraryNav.map(renderItem)}
      </nav>

      {/* A flex column stretches the tooltip wrapper, as in the nav above, so the
          collapsed button spans the rail and its icon sits centred. */}
      <div className="flex flex-col px-3 pb-3">
        {renderItem({ page: "settings", label: "Settings", icon: GearSix })}
      </div>
    </motion.aside>
  );
}
