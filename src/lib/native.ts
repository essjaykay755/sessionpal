import type {
  AgentDetection,
  AgentId,
  BackupRecord,
  DeleteResult,
  ExportFormat,
  FolderAccess,
  ProjectAccess,
  RestoreResult,
  SessionDetail,
  SessionLocator,
} from "./types";

export const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export type Platform = "macos" | "windows" | "linux";

export function platform(): Platform {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux") && !ua.includes("android")) return "linux";
  return "macos";
}

/** Where deleted sessions and backups go, in the platform's own words. */
export function trashName(): string {
  return platform() === "windows" ? "Recycle Bin" : "Trash";
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("Native bridge unavailable in the browser preview.");
  const api = await import("@tauri-apps/api/core");
  return api.invoke<T>(command, args);
}

export async function detectAgents(): Promise<AgentDetection[]> {
  return invoke<AgentDetection[]>("discover_agents");
}

export async function fetchSessions(
  agents: AgentId[],
  access: ProjectAccess,
): Promise<import("./types").SessionSummary[]> {
  return invoke<import("./types").SessionSummary[]>("list_sessions", { agents, access });
}

/**
 * The privacy-protected folders these working directories are in. With
 * `request`, each is opened once, so macOS asks the user if they have not
 * decided yet. Without it, nothing on disk is read.
 */
export async function fetchProjectFolders(cwds: string[], request: boolean): Promise<FolderAccess[]> {
  return invoke<FolderAccess[]>("project_folders", { cwds, request });
}

/** Opens System Settings at Privacy & Security → Files and Folders. */
export async function openFolderPrivacySettings(): Promise<void> {
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders");
}

export async function fetchSession(locator: SessionLocator): Promise<SessionDetail> {
  return invoke<SessionDetail>("get_session", {
    id: locator.id,
    agent: locator.agent,
    path: locator.path,
  });
}

export async function fetchBackups(): Promise<BackupRecord[]> {
  return invoke<BackupRecord[]>("list_backups");
}

export async function createNativeBackup(
  name: string,
  agents: AgentId[],
): Promise<BackupRecord> {
  return invoke<BackupRecord>("create_backup", { name, agents });
}

export async function restoreNativeBackup(id: string): Promise<RestoreResult> {
  return invoke<RestoreResult>("restore_backup", { id });
}

export async function importNativeBackup(source: string): Promise<BackupRecord> {
  return invoke<BackupRecord>("import_backup", { source });
}

export async function deleteNativeBackup(id: string): Promise<void> {
  await invoke("delete_backup", { id });
}

export async function deleteNativeSessions(
  sessions: SessionLocator[],
): Promise<DeleteResult> {
  return invoke<DeleteResult>("delete_sessions", { sessions });
}

export async function exportNativeSessions(
  sessions: SessionLocator[],
  format: ExportFormat,
  destination: string,
): Promise<{ written: number; destination: string }> {
  return invoke("export_sessions", { sessions, format, destination });
}

export async function exportNativeBackup(
  id: string,
  destination: string,
): Promise<{ destination: string; sizeBytes: number }> {
  return invoke("export_backup", { id, destination });
}

export async function saveDialog(options: {
  title: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (!isTauri) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const result = await dialog.save({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  return result ?? null;
}

export async function openFileDialog(options: {
  title: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (!isTauri) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const result = await dialog.open({
    title: options.title,
    filters: options.filters,
    multiple: false,
    directory: false,
  });
  return typeof result === "string" ? result : null;
}

export async function revealPath(path: string): Promise<void> {
  if (!isTauri) throw new Error("Reveal is only available in the desktop app.");
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.revealItemInDir(path);
}

export async function openPath(path: string): Promise<void> {
  if (!isTauri) throw new Error("Opening locations is only available in the desktop app.");
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openPath(path);
}

/** Opens a web link in the default browser. */
export async function openUrl(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openUrl(url);
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export async function appPaths(): Promise<{
  appDataDir: string;
  backupDir: string;
}> {
  return invoke("app_paths");
}
