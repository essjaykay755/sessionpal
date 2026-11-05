import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { WarningCircle } from "@phosphor-icons/react";
import { AppProvider, useApp } from "./lib/store";
import type { PageId } from "./lib/types";
import { Sidebar } from "./components/Sidebar";
import { platform } from "./lib/native";
import { Topbar } from "./components/Topbar";
import { ScanFailedState, ScanningState } from "./components/ScanningState";
import { CommandPalette } from "./components/CommandPalette";
import { DialogHost } from "./components/Dialogs";
import { Toasts } from "./components/Toasts";
import { Button } from "./components/ui";
import OverviewPage from "./pages/Overview";
import SessionsPage from "./pages/Sessions";
import UsagePage from "./pages/Usage";
import BackupsPage from "./pages/Backups";
import ManagePage from "./pages/Manage";
import SettingsPage from "./pages/Settings";

const PAGE_ORDER: PageId[] = ["overview", "sessions", "usage", "backups", "manage", "settings"];

const PAGES: Record<PageId, () => React.ReactElement> = {
  overview: OverviewPage,
  sessions: SessionsPage,
  usage: UsagePage,
  backups: BackupsPage,
  manage: ManagePage,
  settings: SettingsPage,
};

function Shell() {
  const {
    page,
    navigate,
    setCommandOpen,
    toggleSidebar,
    dialog,
    closeDialog,
    commandOpen,
    demo,
    native,
    error,
    rescan,
    loading,
    notify,
    sessions,
    scanned,
  } = useApp();
  const noticeShown = useRef(false);

  useEffect(() => {
    if (noticeShown.current) return;
    noticeShown.current = true;
    if (demo && !native) {
      const key = "sessionpal.preview-notice.v1";
      let seen = false;
      try {
        seen = sessionStorage.getItem(key) === "1";
        sessionStorage.setItem(key, "1");
      } catch {
        seen = false;
      }
      if (!seen) {
        const timer = window.setTimeout(() => {
          notify(
            "Preview with sample data",
            "Explore all 2,846 sample sessions. The desktop build reads your real local agent files.",
          );
        }, 900);
        return () => window.clearTimeout(timer);
      }
    }
  }, [demo, native, notify]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "k") {
        event.preventDefault();
        setCommandOpen(!commandOpen);
        return;
      }
      if (mod && key === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && key === ",") {
        event.preventDefault();
        navigate("settings");
        return;
      }
      if (mod && /^[1-6]$/.test(event.key)) {
        event.preventDefault();
        navigate(PAGE_ORDER[Number(event.key) - 1]);
        return;
      }
      if (event.key === "Escape") {
        if (dialog) closeDialog();
        else if (commandOpen) setCommandOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    commandOpen,
    dialog,
    closeDialog,
    navigate,
    setCommandOpen,
    toggleSidebar,
  ]);

  const Page = PAGES[page];
  const scanning = native && loading && sessions.length === 0 && !error;
  const scanFailed = native && !scanned && !loading && Boolean(error);

  return (
    <div className={`app-stage${native && platform() === "macos" ? " mac-native" : ""}`}>
      <div className="window-shell relative flex overflow-hidden border border-black/[0.09] bg-canvas dark:border-white/[0.08]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          {native && scanned && error && (
            <div className="mx-6 mb-1 flex shrink-0 items-center justify-between gap-3 rounded-[12px] border border-warning-solid/25 bg-warning-solid/[0.08] px-3 py-2 text-11 text-warning xl:mx-8">
              <span className="flex min-w-0 items-center gap-2">
                <WarningCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {`Scan failed: ${error}. Showing the last successful scan.`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2 text-11"
                onClick={() => void rescan()}
              >
                Retry
              </Button>
            </div>
          )}
          <main className="relative min-h-0 flex-1">
            {loading && !scanning && (
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: [0, 0.7, 0.9] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-x-0 top-0 z-30 h-[2px] origin-left bg-copper-400"
              />
            )}
            <div
              key={scanning ? "scanning" : scanFailed ? "scan-failed" : page}
              className="absolute inset-0"
            >
              {scanning ? (
                <ScanningState />
              ) : scanFailed ? (
                <ScanFailedState error={error ?? ""} onRetry={() => void rescan()} />
              ) : (
                <Page />
              )}
            </div>
          </main>
        </div>
      </div>
      <CommandPalette />
      <DialogHost />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
