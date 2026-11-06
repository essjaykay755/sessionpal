import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import { isTauri, platform } from "./native";
import { useApp } from "./store";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
export const RELEASES_URL = "https://github.com/essjaykay755/sessionpal/releases/latest";
type Status = "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "error";
interface UpdateContextValue {
  supported: boolean;
  status: Status;
  version: string | null;
  progress: number | null;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
}
const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { settings } = useApp();
  const supported = isTauri && (platform() === "macos" || platform() === "windows");
  const [status, setStatus] = useState<Status>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const busy = useRef(false);

  const checkForUpdates = useCallback(async () => {
    if (!supported || busy.current) return;
    busy.current = true;
    setStatus("checking");
    setError(null);
    try {
      const next = await check({ timeout: 20000 });
      const old = updateRef.current;
      updateRef.current = next;
      if (old) void old.close().catch(() => undefined);
      setVersion(next?.version ?? null);
      setStatus(next ? "available" : "current");
    } catch (cause) {
      setError(String(cause));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, [supported]);

  useEffect(() => {
    if (!supported || !settings.automaticUpdates) return;
    void checkForUpdates();
    const timer = window.setInterval(() => void checkForUpdates(), CHECK_INTERVAL);
    return () => window.clearInterval(timer);
  }, [supported, settings.automaticUpdates, checkForUpdates]);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update || busy.current) return;
    busy.current = true;
    let received = 0;
    let total = 0;
    try {
      if (!await ask(`Install SessionPal ${update.version}? The app will close and restart to finish the update.`, { title: "Install update", kind: "info" })) return;
      setError(null);
      setProgress(null);
      setStatus("downloading");
      await update.download((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(100, Math.round(received / total * 100)));
        }
      }, { timeout: 300000 });
      setStatus("installing");
      await update.install();
      if (platform() === "macos") await relaunch();
    } catch (cause) {
      setError(String(cause));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, []);

  return <UpdateContext.Provider value={{ supported, status, version, progress, error, checkForUpdates, installUpdate }}>{children}</UpdateContext.Provider>;
}

export function useUpdates() {
  const value = useContext(UpdateContext);
  if (!value) throw new Error("useUpdates must be used inside UpdateProvider");
  return value;
}
