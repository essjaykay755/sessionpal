import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AGENTS, AGENT_ORDER } from "./agents";
import {
  DEMO_ACTIVITY,
  DEMO_AGENT_COUNTS,
  DEMO_BACKUPS,
  DEMO_SESSIONS,
  demoSessionDetail,
} from "./demo";
import { createDemoBackupZip, exportSessionsToBrowser } from "./exporting";
import {
  appPaths,
  closeWindow,
  createNativeBackup,
  deleteNativeBackup,
  deleteNativeSessions,
  detectAgents,
  exportNativeBackup,
  exportNativeSessions,
  fetchBackups,
  fetchProjectFolders,
  fetchSession,
  fetchCachedLibrary,
  fetchSessions,
  importNativeBackup,
  isTauri,
  minimizeWindow,
  openFileDialog,
  platform,
  restoreNativeBackup,
  revealPath as revealNativePath,
  saveDialog,
  setPricingCatalog,
  toggleMaximizeWindow,
  trashName,
} from "./native";
import type {
  ActivityEvent,
  AgentDetection,
  AgentId,
  AppSettings,
  BackupRecord,
  DeleteResult,
  DialogState,
  ExportFormat,
  FolderAccess,
  PageId,
  ProjectAccess,
  RestoreResult,
  SessionDetail,
  SessionLocator,
  SessionSummary,
  ThemeSetting,
  ToastMessage,
} from "./types";
import { bytes, filenameStamp, money, number, slugify, uid } from "./utils";
import { loadLivePrices } from "./live-pricing";
import { setLiveModels } from "./pricing";

const PAGE_IDS: PageId[] = ["overview", "sessions", "usage", "backups", "manage", "settings"];
const SETTINGS_KEY = "sessionpal.settings.v1";
// Settings saved before the app was renamed from SessionDen.
const LEGACY_SETTINGS_KEY = "sessionden.settings.v1";

function defaultSettings(): AppSettings {
  return {
    onboarded: false,
    enabledAgents: [...AGENT_ORDER],
    projectAccess: { inspect: true, allowedFolders: [] },
    theme: "light",
    sidebarExpanded: true,
    automaticUpdates: true,
    showCosts: true,
    reduceMotion: false,
    defaultExport: "markdown",
    backupFolder:
      platform() === "windows"
        ? "%APPDATA%\\com.sessionpal.desktop\\backups"
        : platform() === "linux"
          ? "~/.local/share/com.sessionpal.desktop/backups"
          : "~/Library/Application Support/com.sessionpal.desktop/backups",
  };
}

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const defaults = defaultSettings();
    const saved = JSON.parse(raw) as Partial<AppSettings>;
    // Settings saved before first-launch setup existed belong to someone who
    // already used the app, which scanned everything and read project folders.
    if (saved.onboarded === undefined) {
      saved.onboarded = true;
      saved.projectAccess ??= { inspect: true, allowedFolders: ["*"] };
    }
    // The backup folder is derived from the platform (and the native app), never
    // from storage, so a path saved by an older build can't linger.
    return {
      ...defaults,
      ...saved,
      enabledAgents: (saved.enabledAgents ?? defaults.enabledAgents).filter((agent) =>
        AGENT_ORDER.includes(agent),
      ),
      backupFolder: defaults.backupFolder,
    };
  } catch {
    return defaultSettings();
  }
}

function demoSessions(): SessionSummary[] {
  return DEMO_SESSIONS;
}

function demoDetections(): AgentDetection[] {
  return AGENT_ORDER.map((id) => ({
    id,
    name: AGENTS[id].name,
    available: true,
    roots: [AGENTS[id].defaultRoot],
    sessionCount: DEMO_AGENT_COUNTS[id],
    note:
      id === "cursor" || id === "antigravity"
        ? "Read-only SQLite discovery"
        : id === "opencode"
          ? "JSON storage · messages and parts"
          : "JSONL transcripts",
  }));
}

interface AppContextValue {
  page: PageId;
  navigate: (page: PageId) => void;
  sessions: SessionSummary[];
  native: boolean;
  demo: boolean;
  demoReason: string | null;
  loading: boolean;
  error: string | null;
  /** True once the desktop app has completed at least one local scan. */
  scanned: boolean;
  lastScanAt: string;
  detections: AgentDetection[];
  backups: BackupRecord[];
  activity: ActivityEvent[];
  selectedSessionId: string | null;
  agentFocus: AgentId | "all";
  focusAgent: (agent: AgentId | "all") => void;
  /** Protected folders (macOS) that sessions ran in, with access status. */
  folderAccess: FolderAccess[];
  requestFolderAccess: (paths: string[]) => Promise<FolderAccess[]>;
  completeOnboarding: (choice: { agents: AgentId[]; access: ProjectAccess }) => Promise<void>;
  updateScanSettings: (
    patch: Partial<Pick<AppSettings, "enabledAgents" | "projectAccess">>,
  ) => Promise<void>;
  /** A `projectKey`, or "all". */
  projectFocus: string;
  setProjectFocus: (project: string) => void;
  /** Opens Sessions filtered to one project (a `projectKey`). */
  focusProject: (project: string) => void;
  openSession: (id: string) => void;
  detail: SessionDetail | null;
  detailLoading: boolean;
  clearSelection: () => void;
  settings: AppSettings;
  effectiveTheme: "light" | "dark";
  updateSettings: (patch: Partial<AppSettings>) => void;
  setTheme: (theme: ThemeSetting) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  dialog: DialogState;
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
  toasts: ToastMessage[];
  notify: (title: string, description?: string, tone?: ToastMessage["tone"]) => void;
  dismissToast: (id: string) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  rescan: () => Promise<void>;
  createBackup: (name: string, agents: AgentId[]) => Promise<BackupRecord>;
  restoreBackup: (id: string) => Promise<RestoreResult>;
  deleteBackup: (id: string) => Promise<void>;
  importBackup: () => Promise<void>;
  exportBackup: (id: string) => Promise<boolean>;
  deleteSessions: (ids: string[]) => Promise<DeleteResult>;
  exportSessions: (
    ids: string[],
    format: ExportFormat,
  ) => Promise<{ exported: number; cancelled: boolean }>;
  revealLocation: (path: string, label?: string) => Promise<void>;
  copyPath: (path: string) => Promise<void>;
  windowAction: (action: "minimize" | "maximize" | "close") => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<PageId>(() => {
    const hash = window.location.hash.replace("#/", "").replace("#", "");
    return PAGE_IDS.includes(hash as PageId) ? (hash as PageId) : "overview";
  });
  const [sessions, setSessions] = useState<SessionSummary[]>(() =>
    isTauri ? [] : demoSessions(),
  );
  const [detections, setDetections] = useState<AgentDetection[]>(() =>
    isTauri ? [] : demoDetections(),
  );
  const [backups, setBackups] = useState<BackupRecord[]>(() =>
    isTauri ? [] : DEMO_BACKUPS,
  );
  const [activity, setActivity] = useState<ActivityEvent[]>(() =>
    isTauri ? [] : DEMO_ACTIVITY,
  );
  const demo = !isTauri;
  const demoReason: string | null = null;
  // The first scan waits for first-launch setup, so it starts only when done.
  const [loading, setLoading] = useState(() => isTauri && readSettings().onboarded);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [lastScanAt, setLastScanAt] = useState(new Date(Date.now() - 4 * 60_000).toISOString());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [agentFocus, setAgentFocus] = useState<AgentId | "all">("all");
  const [projectFocus, setProjectFocus] = useState("all");
  const [detailCache, setDetailCache] = useState<Record<string, SessionDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(readSettings);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [systemDark, setSystemDark] = useState(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [folderAccess, setFolderAccess] = useState<FolderAccess[]>([]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const booted = useRef(false);
  const hasLocalScan = useRef(false);
  /** True while the library from the last run is on screen. */
  const showingCache = useRef(false);
  const toastTimers = useRef<Record<string, number>>({});

  const effectiveTheme: "light" | "dark" =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  const notify = useCallback(
    (title: string, description?: string, tone: ToastMessage["tone"] = "default") => {
      const id = uid("toast");
      setToasts((current) => [...current.slice(-3), { id, title, description, tone }]);
      const timer = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
        delete toastTimers.current[id];
      }, 4600);
      toastTimers.current[id] = timer;
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    if (toastTimers.current[id]) {
      window.clearTimeout(toastTimers.current[id]);
      delete toastTimers.current[id];
    }
  }, []);

  useEffect(() => {
    const cleanup = () => {
      Object.values(toastTimers.current).forEach((timer) => window.clearTimeout(timer));
    };
    return cleanup;
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", effectiveTheme === "dark");
    document.documentElement.classList.toggle("light", effectiveTheme === "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      effectiveTheme === "dark" ? "#141210" : "#171411",
    );
  }, [effectiveTheme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", settings.reduceMotion);
  }, [settings.reduceMotion]);

  useEffect(() => {
    if (isTauri) document.documentElement.classList.add("native");
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace("#/", "").replace("#", "");
      if (PAGE_IDS.includes(hash as PageId)) setPage(hash as PageId);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: PageId) => {
    setPage(next);
    try {
      window.history.replaceState(null, "", `#/${next}`);
    } catch {
      window.location.hash = `#/${next}`;
    }
    setCommandOpen(false);
  }, []);

  /**
   * Lists the protected folders sessions ran in, and re-checks the ones the
   * user allowed (no prompt appears for an answered request), so access
   * revoked in System Settings shows up as "denied".
   */
  const refreshFolderAccess = useCallback(
    async (list: SessionSummary[], access: ProjectAccess) => {
      if (!isTauri || platform() !== "macos") return;
      try {
        const cwds = list.map((session) => session.cwd);
        const folders = await fetchProjectFolders(cwds, false);
        const allowed = (folder: FolderAccess) =>
          access.inspect &&
          access.allowedFolders.some((path) => path === "*" || path === folder.path);
        const probeCwds = cwds.filter((cwd) =>
          folders.some((folder) => allowed(folder) && isInside(cwd, folder.path)),
        );
        const probed = probeCwds.length ? await fetchProjectFolders(probeCwds, true) : [];
        setFolderAccess(
          folders.map((folder) => ({
            ...folder,
            status: probed.find((item) => item.path === folder.path)?.status ?? "unknown",
          })),
        );
      } catch {
        // Folder status is advisory; a failure here must not fail the scan.
      }
    },
    [],
  );

  const loadNative = useCallback(
    async (scope?: { agents: AgentId[]; access: ProjectAccess }) => {
      if (!isTauri) return null;
      const agents = scope?.agents ?? settingsRef.current.enabledAgents;
      const access = scope?.access ?? settingsRef.current.projectAccess;
      setLoading(true);
      setError(null);
      try {
        const prices = await loadLivePrices();
        try {
          await setPricingCatalog(prices);
          setLiveModels(prices);
        } catch {
          // A damaged or incompatible remote cache must not block local scans.
          await setPricingCatalog([]);
          setLiveModels([]);
        }
        const [nextDetections, nextSessions, nextBackups, paths] = await Promise.all([
          detectAgents(),
          fetchSessions(agents, access),
          fetchBackups().catch(() => []),
          appPaths().catch(() => null),
        ]);
        setDetections(nextDetections);
        setSessions(nextSessions);
        // Transcripts may have grown, moved or been deleted since they were cached.
        setDetailCache({});
        setBackups(nextBackups);
        if (paths?.backupDir) {
          setSettings((current) => ({ ...current, backupFolder: paths.backupDir }));
        }
        void refreshFolderAccess(nextSessions, access);
        hasLocalScan.current = true;
        setScanned(true);
        setLastScanAt(new Date().toISOString());
        return nextSessions.length;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        // Never fall back to sample data in the desktop app: fake sessions, costs
        // and simulated deletes would look like the user's real library.
        notify(
          "Scan failed",
          hasLocalScan.current || showingCache.current
            ? "Showing the sessions from the last successful scan. Nothing was changed on disk."
            : "SessionPal couldn't read local agent storage. Nothing was changed on disk.",
          "danger",
        );
        return null;
      } finally {
        setLoading(false);
      }
    },
    [notify, refreshFolderAccess],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (isTauri && settingsRef.current.onboarded) {
      // Show the library from the last scan at once, then refresh it in the
      // background. A fresh scan that lands first always wins.
      void fetchCachedLibrary(settingsRef.current.enabledAgents)
        .then((cached) => {
          if (!cached || hasLocalScan.current) return;
          setSessions(cached.sessions);
          if (cached.detections.length) setDetections(cached.detections);
          setLastScanAt(cached.scannedAt);
          // If the fresh scan fails, keep this library on screen with a warning.
          showingCache.current = true;
          setScanned(true);
        })
        .catch(() => {
          // The cache is only a head start; the scan below still runs.
        });
      void loadNative();
    }
  }, [loadNative]);

  const completeOnboarding = useCallback(
    async (choice: { agents: AgentId[]; access: ProjectAccess }) => {
      const next = { ...settingsRef.current, onboarded: true, enabledAgents: choice.agents, projectAccess: choice.access };
      settingsRef.current = next;
      setSettings(next);
      await loadNative(choice);
    },
    [loadNative],
  );

  /** Changes which agents and folders scans cover, then rescans. */
  const updateScanSettings = useCallback(
    async (patch: Partial<Pick<AppSettings, "enabledAgents" | "projectAccess">>) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      if (isTauri) await loadNative();
    },
    [loadNative],
  );

  /**
   * Opens each protected folder once so macOS asks for access, then records
   * the folders that were granted. Returns the folders with their status.
   */
  const requestFolderAccess = useCallback(
    async (paths: string[]) => {
      const cwds = sessions.map((session) => session.cwd).filter((cwd) => paths.some((path) => isInside(cwd, path)));
      const result = cwds.length ? await fetchProjectFolders(cwds, true) : [];
      const granted = result.filter((folder) => folder.status === "granted").map((folder) => folder.path);
      const current = settingsRef.current.projectAccess;
      const access: ProjectAccess = {
        inspect: true,
        allowedFolders: Array.from(new Set([...current.allowedFolders, ...granted])),
      };
      const next = { ...settingsRef.current, projectAccess: access };
      settingsRef.current = next;
      setSettings(next);
      setFolderAccess((folders) =>
        folders.map((folder) => result.find((item) => item.path === folder.path) ?? folder),
      );
      if (granted.length) await loadNative();
      return result;
    },
    [sessions, loadNative],
  );

  useEffect(() => {
    if (selectedSessionId) return;
    if (sessions.length === 0) return;
    setSelectedSessionId(sessions[0].id);
  }, [sessions, selectedSessionId]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (detailCache[id]) return detailCache[id];
      setDetailLoading(true);
      try {
        let next: SessionDetail | null = null;
        if (isTauri && !demo) {
          const summary = sessions.find((session) => session.id === id);
          if (summary) {
            next = await fetchSession({
              id: summary.id,
              agent: summary.agent,
              path: summary.path,
            });
            // The listing knows every project, so its labels are disambiguated.
            next = {
              ...next,
              projectRoot: summary.projectRoot ?? next.projectRoot,
              projectRootLabel: summary.projectRootLabel ?? next.projectRootLabel,
            };
          }
        } else {
          next = demoSessionDetail(id);
        }
        if (next) {
          setDetailCache((current) => ({ ...current, [id]: next as SessionDetail }));
          return next;
        }
        return null;
      } catch (cause) {
        notify(
          "Couldn't load conversation",
          cause instanceof Error ? cause.message : "The session file could not be read.",
        );
        return null;
      } finally {
        setDetailLoading(false);
      }
    },
    [detailCache, demo, notify, sessions],
  );

  const openSession = useCallback(
    (id: string) => {
      setSelectedSessionId(id);
      if (!detailCache[id]) void loadDetail(id);
    },
    [detailCache, loadDetail],
  );

  const clearSelection = useCallback(() => setSelectedSessionId(null), []);

  const focusAgent = useCallback(
    (agent: AgentId | "all") => {
      setAgentFocus(agent);
      navigate("sessions");
    },
    [navigate],
  );

  const focusProject = useCallback(
    (project: string) => {
      setAgentFocus("all");
      setProjectFocus(project);
      navigate("sessions");
    },
    [navigate],
  );

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const setTheme = useCallback(
    (theme: ThemeSetting) => updateSettings({ theme }),
    [updateSettings],
  );

  const toggleTheme = useCallback(() => {
    const next = effectiveTheme === "dark" ? "light" : "dark";
    updateSettings({ theme: next });
  }, [effectiveTheme, updateSettings]);

  const toggleSidebar = useCallback(
    () => updateSettings({ sidebarExpanded: !settings.sidebarExpanded }),
    [settings.sidebarExpanded, updateSettings],
  );

  const openDialog = useCallback((next: DialogState) => {
    setCommandOpen(false);
    setDialog(next);
  }, []);

  const closeDialog = useCallback(() => setDialog(null), []);

  const addActivity = useCallback((event: Omit<ActivityEvent, "id" | "at">) => {
    setActivity((current) =>
      [
        {
          ...event,
          id: uid("act"),
          at: new Date().toISOString(),
        },
        ...current,
      ]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 24),
    );
  }, []);

  const rescan = useCallback(async () => {
    if (!isTauri) {
      setLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 900));
      setLoading(false);
      setLastScanAt(new Date().toISOString());
      notify(
        "Sample library refreshed",
        "Native discovery is available when SessionPal runs as a desktop app.",
      );
      return;
    }
    const count = await loadNative();
    if (count !== null) {
      addActivity({
        kind: "scan",
        title: "Discovery scan complete",
        detail: `${number(count)} sessions checked`,
      });
      notify("Library refreshed", undefined, "success");
    }
  }, [addActivity, loadNative, notify]);

  const createBackup = useCallback(
    async (name: string, agents: AgentId[]) => {
      const uniqueName = name.trim() || `Backup · ${new Date().toLocaleDateString()}`;
      if (isTauri && !demo) {
        const record = await createNativeBackup(uniqueName, agents);
        setBackups((current) => [record, ...current]);
        addActivity({
          kind: "backup",
          title: "Backup created",
          detail: `${uniqueName} · ${bytes(record.sizeBytes)}`,
        });
        notify("Backup created", `${number(record.sessionCount)} sessions saved locally.`, "success");
        return record;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const scoped = sessions.filter((session) => agents.includes(session.agent));
      const total = scoped.reduce((sum, session) => sum + session.sizeBytes, 0);
      const record: BackupRecord = {
        id: uid("bkp"),
        name: uniqueName,
        createdAt: new Date().toISOString(),
        sizeBytes: Math.max(12 * 1024 * 1024, Math.round(total * 0.34)),
        sessionCount: scoped.length,
        agents,
        fileCount: scoped.length + agents.length + 2,
        path: `${settings.backupFolder}/${slugify(uniqueName)}-${filenameStamp()}.zip`,
        demo: true,
      };
      setBackups((current) => [record, ...current]);
      addActivity({
        kind: "backup",
        title: "Sample backup created",
        detail: `${uniqueName} · ${bytes(record.sizeBytes)}`,
      });
      notify(
        "Sample backup created",
        `${number(record.sessionCount)} sessions · ${bytes(record.sizeBytes)}. Saved in the preview library.`,
        "success",
      );
      return record;
    },
    [addActivity, demo, notify, sessions, settings.backupFolder],
  );

  const restoreBackup = useCallback(
    async (id: string) => {
      const backup = backups.find((item) => item.id === id);
      if (!backup) throw new Error("Backup not found.");
      if (isTauri && !demo) {
        const result = await restoreNativeBackup(id);
        await loadNative();
        const kept = result.keptLocal + result.unchanged;
        const parts = [`${number(result.restored)} missing file${result.restored === 1 ? "" : "s"} restored`];
        if (kept > 0) parts.push(`${number(kept)} already on disk, left as-is`);
        if (result.skippedReadOnly > 0) parts.push("agent databases left untouched");
        addActivity({
          kind: "restore",
          title: result.errors.length ? "Backup partly restored" : "Backup restored",
          detail: `${backup.name} · ${parts[0]}`,
        });
        if (result.errors.length) {
          notify(
            `Restore finished with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`,
            `${parts.join(". ")}. First error: ${result.errors[0]}`,
            "danger",
          );
        } else {
          notify("Restore complete", `${parts.join(". ")}.`, "success");
        }
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 1800));
      addActivity({
        kind: "restore",
        title: "Sample restore completed",
        detail: `${backup.name} · ${number(backup.sessionCount)} sessions`,
      });
      notify(
        "Sample restore complete",
        "The preview restored the sample library. Native restores only add missing files and never overwrite existing ones.",
        "success",
      );
      return {
        restored: backup.fileCount,
        unchanged: 0,
        keptLocal: 0,
        skippedReadOnly: 0,
        errors: [],
      };
    },
    [addActivity, backups, demo, loadNative, notify],
  );

  const deleteBackup = useCallback(
    async (id: string) => {
      const backup = backups.find((item) => item.id === id);
      if (!backup) return;
      if (isTauri && !demo) await deleteNativeBackup(id);
      else await new Promise((resolve) => setTimeout(resolve, 500));
      setBackups((current) => current.filter((item) => item.id !== id));
      addActivity({ kind: "delete", title: "Backup removed", detail: `${backup.name} · ${bytes(backup.sizeBytes)}` });
      notify("Backup deleted", backup.name);
    },
    [addActivity, backups, demo, notify],
  );

  const importBackup = useCallback(async () => {
    if (!isTauri) {
      notify(
        "Available in the desktop app",
        "Importing a backup archive from disk is handled natively by SessionPal.",
      );
      return;
    }
    const source = await openFileDialog({
      title: "Import backup",
      filters: [{ name: "SessionPal backup", extensions: ["zip"] }],
    });
    if (!source) return;
    try {
      const record = await importNativeBackup(source);
      setBackups((current) =>
        [record, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      addActivity({
        kind: "backup",
        title: "Backup imported",
        detail: `${record.name} · ${bytes(record.sizeBytes)}`,
      });
      notify(
        "Backup imported",
        `${record.name} · ${number(record.sessionCount)} sessions. Restore it to bring missing sessions back.`,
        "success",
      );
    } catch (cause) {
      notify(
        "Couldn't import backup",
        cause instanceof Error ? cause.message : String(cause),
        "danger",
      );
    }
  }, [addActivity, notify]);

  const exportBackup = useCallback(
    async (id: string) => {
      const backup = backups.find((item) => item.id === id);
      if (!backup) return false;
      if (isTauri && !demo) {
        const destination = await saveDialog({
          title: "Export backup",
          defaultPath: `${slugify(backup.name)}-${filenameStamp()}.zip`,
          filters: [{ name: "SessionPal backup", extensions: ["zip"] }],
        });
        if (!destination) return false;
        await exportNativeBackup(id, destination);
        notify("Backup exported", destination, "success");
        return true;
      }
      const scoped = sessions.filter((session) => backup.agents.includes(session.agent));
      const sampleDetails = scoped
        .slice(0, 32)
        .map((session) => demoSessionDetail(session.id))
        .filter((detail): detail is SessionDetail => Boolean(detail));
      const filename = createDemoBackupZip(backup, scoped, sampleDetails);
      addActivity({
        kind: "export",
        title: "Sample backup exported",
        detail: `${backup.name} · ${filename}`,
      });
      notify(
        "Sample archive downloaded",
        "The preview export includes a manifest and sample transcripts. The desktop app archives every session file.",
        "success",
      );
      return true;
    },
    [addActivity, backups, demo, notify, sessions],
  );

  const deleteSessions = useCallback(
    async (ids: string[]) => {
      const selected = sessions.filter((session) => ids.includes(session.id));
      const deletable = selected.filter((session) => session.deletable);
      let result: DeleteResult = { deleted: 0, skipped: selected.length - deletable.length, errors: [] };
      if (isTauri && !demo) {
        const locators: SessionLocator[] = deletable.map((session) => ({
          id: session.id,
          agent: session.agent,
          path: session.path,
        }));
        result = await deleteNativeSessions(locators);
        if (selectedSessionId && deletable.some((session) => session.id === selectedSessionId)) {
          setSelectedSessionId(null);
        }
        // Refresh from disk so a partial failure never hides a session that still exists.
        await loadNative();
      } else {
        await new Promise((resolve) => setTimeout(resolve, 650));
        result = { ...result, deleted: deletable.length };
        const deletedIds = new Set(deletable.map((session) => session.id));
        setSessions((current) => current.filter((session) => !deletedIds.has(session.id)));
        setDetailCache((current) => {
          const next = { ...current };
          deletedIds.forEach((id) => delete next[id]);
          return next;
        });
        if (selectedSessionId && deletedIds.has(selectedSessionId)) {
          setSelectedSessionId(null);
        }
      }
      const reclaimed = deletable.reduce((sum, session) => sum + session.sizeBytes, 0);
      if (result.deleted > 0) {
        addActivity({
          kind: "delete",
          title: result.deleted === 1 ? "1 session removed" : `${number(result.deleted)} sessions removed`,
          detail: result.errors.length
            ? `${number(result.deleted)} removed · ${result.errors.length} failed`
            : result.skipped > 0
              ? `${bytes(reclaimed)} moved to the ${trashName()} · ${result.skipped} skipped`
              : `${bytes(reclaimed)} moved to the ${trashName()}`,
        });
        notify(
          result.deleted === 1 ? "Session deleted" : `${number(result.deleted)} sessions deleted`,
          result.errors.length
            ? `${result.errors.length} file operation(s) failed. The library was refreshed from disk.`
            : result.skipped
              ? `Moved to the ${trashName()}. ${result.skipped} database-managed sessions were left untouched.`
              : `Moved to the ${trashName()}. Restore from there if you change your mind.`,
          result.errors.length ? "danger" : "success",
        );
      }
      if (result.errors.length > 0) {
        notify("Some sessions couldn't be deleted", result.errors[0], "danger");
      }
      return result;
    },
    [addActivity, demo, loadNative, notify, selectedSessionId, sessions],
  );

  const exportSessions = useCallback(
    async (ids: string[], format: ExportFormat) => {
      const selected = sessions.filter((session) => ids.includes(session.id));
      if (!selected.length) return { exported: 0, cancelled: true };
      if (isTauri && !demo) {
        const suffix = format === "json" ? "json" : "md";
        const destination = await saveDialog({
          title: selected.length === 1 ? "Export session" : "Export sessions",
          defaultPath: `sessionpal-export-${filenameStamp()}.${suffix}`,
          filters: [
            format === "json"
              ? { name: "JSON", extensions: ["json"] }
              : { name: "Markdown", extensions: ["md"] },
          ],
        });
        if (!destination) return { exported: 0, cancelled: true };
        const result = await exportNativeSessions(
          selected.map((session) => ({ id: session.id, agent: session.agent, path: session.path })),
          format,
          destination,
        );
        addActivity({
          kind: "export",
          title: `${number(result.written)} session${result.written === 1 ? "" : "s"} exported`,
          detail: `${format === "json" ? "JSON" : "Markdown"} · ${destination}`,
        });
        notify(
          "Export complete",
          `${number(result.written)} session${result.written === 1 ? "" : "s"} written to disk.`,
          "success",
        );
        return { exported: result.written, cancelled: false };
      }
      const details = selected
        .map((session) => demoSessionDetail(session.id))
        .filter((detail): detail is SessionDetail => Boolean(detail));
      const filename = exportSessionsToBrowser(details, format);
      addActivity({
        kind: "export",
        title: `${number(details.length)} sample session${details.length === 1 ? "" : "s"} exported`,
        detail: `${format === "json" ? "JSON" : "Markdown"} · ${filename}`,
      });
      notify(
        "Sample export downloaded",
        `${details.length} transcript${details.length === 1 ? "" : "s"} written as ${format === "json" ? "JSON" : "Markdown"}.`,
        "success",
      );
      return { exported: details.length, cancelled: false };
    },
    [addActivity, demo, notify, sessions],
  );

  const revealLocation = useCallback(
    async (path: string, label?: string) => {
      if (!isTauri) {
        notify(
          "Available in the desktop app",
          label
            ? `Revealing ${label} in your file manager works in the desktop app.`
            : "SessionPal reveals local files in your file manager when running as a desktop app.",
        );
        return;
      }
      try {
        await revealNativePath(path);
      } catch (cause) {
        notify("Couldn't reveal location", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [notify],
  );

  const copyPath = useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(path);
        notify("Path copied", path.length > 72 ? `${path.slice(0, 69)}…` : path);
      } catch {
        notify("Couldn't copy path", "Clipboard access was blocked by the browser.");
      }
    },
    [notify],
  );

  const windowAction = useCallback(
    async (action: "minimize" | "maximize" | "close") => {
      if (!isTauri) {
        notify(
          "Window controls are native",
          "Minimize, maximize and close are handled by the desktop window. This browser preview stays open.",
        );
        return;
      }
      if (action === "minimize") await minimizeWindow();
      if (action === "maximize") await toggleMaximizeWindow();
      if (action === "close") await closeWindow();
    },
    [notify],
  );

  // The preview has a fixed sample library, so agent choices filter it here;
  // the desktop app simply doesn't scan agents that are switched off.
  const visibleSessions = useMemo(
    () => (demo ? sessions.filter((session) => settings.enabledAgents.includes(session.agent)) : sessions),
    [demo, sessions, settings.enabledAgents],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      page,
      navigate,
      sessions: visibleSessions,
      native: isTauri,
      demo,
      demoReason,
      loading,
      error,
      scanned,
      lastScanAt,
      detections,
      backups,
      activity,
      selectedSessionId,
      agentFocus,
      focusAgent,
      folderAccess,
      requestFolderAccess,
      completeOnboarding,
      updateScanSettings,
      projectFocus,
      setProjectFocus,
      focusProject,
      openSession,
      detail: selectedSessionId ? detailCache[selectedSessionId] ?? null : null,
      detailLoading,
      clearSelection,
      settings,
      effectiveTheme,
      updateSettings,
      setTheme,
      toggleTheme,
      toggleSidebar,
      dialog,
      openDialog,
      closeDialog,
      toasts,
      notify,
      dismissToast,
      commandOpen,
      setCommandOpen,
      rescan,
      createBackup,
      restoreBackup,
      deleteBackup,
      importBackup,
      exportBackup,
      deleteSessions,
      exportSessions,
      revealLocation,
      copyPath,
      windowAction,
    }),
    [
      page,
      navigate,
      visibleSessions,
      demo,
      demoReason,
      loading,
      error,
      scanned,
      lastScanAt,
      detections,
      backups,
      activity,
      selectedSessionId,
      agentFocus,
      focusAgent,
      folderAccess,
      requestFolderAccess,
      completeOnboarding,
      updateScanSettings,
      projectFocus,
      setProjectFocus,
      focusProject,
      openSession,
      detailCache,
      detailLoading,
      clearSelection,
      settings,
      effectiveTheme,
      updateSettings,
      setTheme,
      toggleTheme,
      toggleSidebar,
      dialog,
      openDialog,
      closeDialog,
      toasts,
      notify,
      dismissToast,
      commandOpen,
      rescan,
      createBackup,
      restoreBackup,
      deleteBackup,
      importBackup,
      exportBackup,
      deleteSessions,
      exportSessions,
      revealLocation,
      copyPath,
      windowAction,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

export function useCostsVisible(): boolean {
  return useApp().settings.showCosts;
}

export function costLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `≈ ${money(value)}`;
}

/** True when a session's working folder is `folder` or inside it. */
export function isInside(cwd: string, folder: string): boolean {
  const clean = cwd.replace(/[\\/]+$/, "");
  return clean === folder || clean.startsWith(`${folder}/`) || clean.startsWith(`${folder}\\`);
}
