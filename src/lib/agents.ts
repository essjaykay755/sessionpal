import type { AgentId, AgentMeta, BackupRecord, ProjectMeta, Tint } from "./types";

export const AGENT_ORDER: AgentId[] = ["claude", "codex", "cursor", "opencode", "antigravity"];

/**
 * Literal class names keep the token rules in src/index.css from being
 * tree-shaken by Tailwind when they are selected from runtime data.
 */
export const AGENT_CLASS: Record<AgentId, string> = {
  claude: "agent-claude",
  codex: "agent-codex",
  cursor: "agent-cursor",
  opencode: "agent-opencode",
  antigravity: "agent-antigravity",
};

export const TINT_CLASS: Record<Tint, string> = {
  peach: "tint-peach",
  sage: "tint-sage",
  lilac: "tint-lilac",
  butter: "tint-butter",
  sky: "tint-sky",
  rose: "tint-rose",
  stone: "tint-stone",
  blue: "tint-blue",
};

export const AGENTS: Record<AgentId, AgentMeta> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    shortName: "Claude",
    description: "Anthropic's terminal agent",
    storageKind: "JSONL",
    defaultRoot: "~/.claude/projects",
    accent: "#bd6a43",
  },
  codex: {
    id: "codex",
    name: "Codex",
    shortName: "Codex",
    description: "OpenAI's coding agent",
    storageKind: "JSONL",
    defaultRoot: "~/.codex/sessions",
    accent: "#6a8150",
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    shortName: "Cursor",
    description: "Cursor's agent & composer",
    storageKind: "SQLite",
    defaultRoot: "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    accent: "#5f7486",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    shortName: "OpenCode",
    description: "The open-source coding agent",
    storageKind: "SQLite",
    defaultRoot: "~/.local/share/opencode/opencode.db",
    accent: "#9a7e37",
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    shortName: "Antigravity",
    description: "Google's agentic IDE",
    storageKind: "SQLite",
    defaultRoot: "~/.gemini/antigravity/conversation_summaries.db",
    accent: "#6b62a6",
  },
};

export const PROJECTS: ProjectMeta[] = [
  {
    slug: "roadster-lab",
    label: "Roadster Lab",
    tint: "peach",
    icon: "RocketLaunch",
    blurb: "Vehicle simulation workspace",
  },
  {
    slug: "prepapp",
    label: "PrepApp",
    tint: "sky",
    icon: "Browser",
    blurb: "Interview preparation app",
  },
  {
    slug: "api-core",
    label: "API Core",
    tint: "sage",
    icon: "Database",
    blurb: "Shared backend services",
  },
  {
    slug: "maglev-demo",
    label: "Maglev",
    tint: "lilac",
    icon: "FilmStrip",
    blurb: "Motion storytelling demo",
  },
  {
    slug: "sessionpal",
    label: "SessionPal",
    tint: "butter",
    icon: "AppWindow",
    blurb: "Local AI session library",
  },
  {
    slug: "meridian",
    label: "Meridian",
    tint: "rose",
    icon: "Shapes",
    blurb: "Design system for the suite",
  },
  {
    slug: "atlas-api",
    label: "Atlas API",
    tint: "blue",
    icon: "CloudArrowUp",
    blurb: "Payments and billing API",
  },
  {
    slug: "ledgerly",
    label: "Ledgerly",
    tint: "sage",
    icon: "Receipt",
    blurb: "Invoicing for small teams",
  },
  {
    slug: "folio",
    label: "Folio",
    tint: "stone",
    icon: "BookOpen",
    blurb: "Publishing workspace",
  },
  {
    slug: "orbit-mobile",
    label: "Orbit",
    tint: "lilac",
    icon: "DeviceMobile",
    blurb: "Habit tracker for iOS",
  },
  {
    slug: "cartograph",
    label: "Cartograph",
    tint: "sky",
    icon: "MapTrifold",
    blurb: "Indoor mapping toolkit",
  },
  {
    slug: "quiet-hours",
    label: "Quiet Hours",
    tint: "stone",
    icon: "MoonStars",
    blurb: "Focus timer and soundscape app",
  },
  {
    slug: "type-foundry",
    label: "Type Foundry",
    tint: "butter",
    icon: "TextAa",
    blurb: "Variable font specimen site",
  },
  {
    slug: "shipped",
    label: "Shipped",
    tint: "peach",
    icon: "Package",
    blurb: "Release notes for product teams",
  },
  {
    slug: "field-notes",
    label: "Field Notes",
    tint: "butter",
    icon: "Notebook",
    blurb: "Research notes and clippings",
  },
  {
    slug: "luma",
    label: "Luma Studio",
    tint: "rose",
    icon: "PaintBrush",
    blurb: "Portfolio for a photo studio",
  },
];

export const PROJECTS_BY_SLUG = Object.fromEntries(
  PROJECTS.map((project) => [project.slug, project]),
) as Record<string, ProjectMeta>;

export function projectFromSlug(slug: string): ProjectMeta {
  return (
    PROJECTS_BY_SLUG[slug] ?? {
      slug,
      label: slug,
      tint: "stone",
      icon: "Folder",
      blurb: "Local project",
    }
  );
}

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: AGENTS.claude.name,
  codex: AGENTS.codex.name,
  cursor: AGENTS.cursor.name,
  opencode: AGENTS.opencode.name,
  antigravity: AGENTS.antigravity.name,
};

/**
 * What restore can do for a backup. Entries copied from a live database
 * (Cursor, Antigravity, database-backed OpenCode) are archive-only. Archives
 * made before this was recorded fall back to the always-database agents.
 */
export function backupCoverage(backup: BackupRecord): {
  archiveOnly: AgentId[];
  canRestore: boolean;
} {
  const archiveOnly =
    backup.archiveOnlyAgents ??
    backup.agents.filter((agent) => agent === "cursor" || agent === "antigravity");
  const canRestore =
    backup.restorableFiles !== undefined
      ? backup.restorableFiles > 0
      : backup.agents.some((agent) => !archiveOnly.includes(agent));
  return { archiveOnly, canRestore };
}

export function agentList(agents: AgentId[]): string {
  const names = agents.map((agent) => AGENTS[agent].name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
