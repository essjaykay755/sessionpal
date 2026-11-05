export type AgentId = "claude" | "codex" | "cursor" | "opencode" | "antigravity";

export type PageId = "overview" | "sessions" | "usage" | "backups" | "manage" | "settings";

export type Tint =
  | "peach"
  | "sage"
  | "lilac"
  | "butter"
  | "sky"
  | "rose"
  | "stone"
  | "blue";

export interface AgentMeta {
  id: AgentId;
  name: string;
  shortName: string;
  description: string;
  storageKind: string;
  defaultRoot: string;
  accent: string;
}

export interface AgentDetection {
  id: AgentId;
  name: string;
  available: boolean;
  roots: string[];
  sessionCount: number;
  note?: string;
}

export interface UsageBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
}

/** Usage that happened on one local calendar day (`YYYY-MM-DD`). */
export interface DayUsage {
  day: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Null when part of the day's usage came from an unpriced model. */
  cost: number | null;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: string;
  model?: string;
  toolName?: string;
  toolDetail?: string;
  toolStatus?: "ok" | "error";
  tokens?: number;
}

export interface SessionSummary {
  id: string;
  agent: AgentId;
  title: string;
  excerpt: string;
  project: string;
  projectLabel: string;
  cwd: string;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  tokens: number;
  sizeBytes: number;
  model: string | null;
  models: string[];
  usage: UsageBreakdown | null;
  /**
   * Usage split by the local day it happened. Empty or missing when the agent
   * only stores session-level totals; analytics then fall back to `updatedAt`.
   */
  usageDays?: DayUsage[];
  format: "jsonl" | "json" | "sqlite";
  path: string;
  /** False for sessions SessionPal can see but not safely remove (e.g. inside Cursor's DB). */
  deletable: boolean;
  /** Hidden facts used to render a realistic transcript in preview mode. */
  demo?: boolean;
  tint: Tint;
  icon: string;
}

export interface SessionDetail extends SessionSummary {
  messages: Message[];
  durationMs: number;
}

export interface BackupRecord {
  id: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  sessionCount: number;
  agents: AgentId[];
  fileCount: number;
  path: string;
  /** Files restore can write back to the agent's own storage. */
  restorableFiles?: number;
  /** Agents whose entries came from a live database and are archive-only. */
  archiveOnlyAgents?: AgentId[];
  demo?: boolean;
}

export interface ActivityEvent {
  id: string;
  kind: "session" | "backup" | "export" | "delete" | "scan" | "restore";
  title: string;
  detail: string;
  at: string;
  agent?: AgentId;
}

export interface ProjectMeta {
  slug: string;
  label: string;
  tint: Tint;
  icon: string;
  blurb: string;
}

export type ThemeSetting = "system" | "light" | "dark";
export type ExportFormat = "markdown" | "json";

export interface AppSettings {
  theme: ThemeSetting;
  sidebarExpanded: boolean;
  showCosts: boolean;
  reduceMotion: boolean;
  defaultExport: ExportFormat;
  backupFolder: string;
}

export type DialogState =
  | { kind: "create-backup" }
  | { kind: "export-sessions"; ids: string[]; label?: string }
  | { kind: "delete-sessions"; ids: string[] }
  | { kind: "restore-backup"; id: string }
  | { kind: "backup-details"; id: string }
  | { kind: "delete-backup"; id: string }
  | { kind: "explain-costs" }
  | { kind: "privacy" }
  | null;

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: "default" | "success" | "danger";
}

export interface SessionLocator {
  id: string;
  agent: AgentId;
  path: string;
}

export interface DeleteResult {
  deleted: number;
  skipped: number;
  errors: string[];
}

export interface RestoreResult {
  /** Missing files written back to disk. */
  restored: number;
  /** Files already on disk with identical contents. */
  unchanged: number;
  /** Files already on disk with different contents, left untouched. */
  keptLocal: number;
  /** Cursor entries; Cursor's live database is never written to. */
  skippedReadOnly: number;
  errors: string[];
}

export type RangeKey = "7d" | "30d" | "90d" | "1y";
