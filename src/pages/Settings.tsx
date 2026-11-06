import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  ArrowCounterClockwise,
  ArrowSquareOut,
  CaretRight,
  Check,
  CloudSlash,
  Copy,
  Database,
  FileText,
  FolderLock,
  FolderOpen,
  GithubLogo,
  Globe,
  HardDrives,
  Info,
  LockSimple,
  MagnifyingGlass,
  Moon,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  UserCircle,
} from "@phosphor-icons/react";
import { AGENTS, AGENT_CLASS, AGENT_ORDER } from "../lib/agents";
import { APP_INFO, RELEASES, formatReleaseDate, type Release } from "../lib/about";
import {
  clearSearchIndex,
  fetchSearchIndexStatus,
  openFolderPrivacySettings,
  openUrl,
  platform,
} from "../lib/native";
import { useApp } from "../lib/store";
import type { AgentId, ExportFormat, SearchIndexStatus, ThemeSetting } from "../lib/types";
import { bytes, cn, homePath, number, relativeTime } from "../lib/utils";
import { AgentMark, BrandMark } from "../components/Brand";
import { PageHeader, PageScroll, SectionNav } from "../components/PageChrome";
import {
  Badge,
  Button,
  EstimatedTag,
  Segmented,
  Switch,
  Tooltip,
} from "../components/ui";

export default function SettingsPage() {
  const {
    settings,
    updateSettings,
    toggleSidebar,
    setTheme,
    effectiveTheme,
    sessions,
    backups,
    detections,
    lastScanAt,
    native,
    demo,
    demoReason,
    rescan,
    loading,
    openDialog,
    revealLocation,
    copyPath,
    notify,
    folderAccess,
    requestFolderAccess,
    updateScanSettings,
  } = useApp();
  const [section, setSection] = useState<"general" | "agents" | "storage" | "privacy" | "about">("general");
  const enabled = settings.enabledAgents;
  const toggleAgent = (agent: AgentId, next: boolean) => {
    const agents = next ? [...enabled, agent] : enabled.filter((id) => id !== agent);
    void updateScanSettings({ enabledAgents: AGENT_ORDER.filter((id) => agents.includes(id)) });
  };
  const access = settings.projectAccess;
  const isAllowed = (path: string) => access.allowedFolders.some((item) => item === "*" || item === path);
  const setFolderAllowed = (path: string, allowed: boolean) => {
    if (allowed) {
      void requestFolderAccess([path]);
      return;
    }
    // A wildcard from older settings becomes the explicit list minus this one.
    const current = access.allowedFolders.includes("*")
      ? folderAccess.map((folder) => folder.path)
      : access.allowedFolders;
    void updateScanSettings({
      projectAccess: { ...access, allowedFolders: current.filter((item) => item !== path) },
    });
  };

  const totalStorage = useMemo(
    () => sessions.reduce((sum, session) => sum + session.sizeBytes, 0),
    [sessions],
  );
  const totalBackupSize = useMemo(
    () => backups.reduce((sum, backup) => sum + backup.sizeBytes, 0),
    [backups],
  );
  const activeAgents = detections.filter((detection) => detection.available).length;

  const resetPreferences = () => {
    updateSettings({
      theme: "light",
      sidebarExpanded: true,
      showCosts: true,
      reduceMotion: false,
      defaultExport: "markdown",
    });
    notify("Preferences reset", "Appearance, motion, costs and export defaults are back to default.");
  };

  const copyDiagnostics = async () => {
    const text = [
      "SessionPal diagnostics",
      `Version: ${APP_INFO.version}`,
      `Mode: ${native ? (demo ? "desktop · sample data" : "desktop · local library") : "browser preview"}`,
      `Platform: ${platform()}`,
      `Sessions: ${sessions.length}`,
      `Agents detected: ${activeAgents}`,
      `Backups: ${backups.length}`,
      `Session storage: ${bytes(totalStorage)}`,
      `Backup storage: ${bytes(totalBackupSize)}`,
      `Last scan: ${lastScanAt}`,
      `Backup folder: ${settings.backupFolder}`,
      demoReason ? `Preview reason: ${demoReason}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      notify("Diagnostics copied", "Local paths and counts only. No conversations included.");
    } catch {
      notify("Couldn't copy diagnostics", "Clipboard access was blocked by the browser.");
    }
  };

  return (
    <PageScroll>
      <PageHeader
        title="Settings"
        subtitle="Preferences are stored on this device."
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowCounterClockwise className="h-3.5 w-3.5" />}
            onClick={resetPreferences}
          >
            Reset preferences
          </Button>
        }
      />

      <SectionNav
        label="Settings sections"
        idPrefix="settings-section"
        value={section}
        onChange={setSection}
        options={[
          { value: "general", label: "General" },
          { value: "agents", label: "Agents & folders" },
          { value: "storage", label: "Storage & search" },
          { value: "privacy", label: "Privacy" },
          { value: "about", label: "About" },
        ]}
      />
      {section === "general" && (
        <div className="flex max-w-[900px] flex-col gap-3.5">
          <section id="appearance" className="card p-5 sm:p-6">
            <SectionHeading
              icon={<Palette className="h-4 w-4" />}
              title="Appearance"
              detail="The workspace, not your data."
            />

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <ThemeCard
                theme="light"
                label="Light"
                active={settings.theme === "light"}
                onSelect={() => setTheme("light")}
              />
              <ThemeCard
                theme="dark"
                label="Dark"
                active={settings.theme === "dark"}
                onSelect={() => setTheme("dark")}
              />
              <ThemeCard
                theme="system"
                label="System"
                active={settings.theme === "system"}
                onSelect={() => setTheme("system")}
              />
            </div>
            <p className="mt-2 px-1 text-11 text-faint">
              {settings.theme === "system"
                ? `Following your system appearance — currently ${effectiveTheme}.`
                : `${settings.theme === "dark" ? "Dark" : "Light"} appearance is pinned regardless of system settings.`}
            </p>

            <div className="mt-5 divide-y divide-line/[0.06] border-t border-line/[0.06]">
              <SettingRow
                title="Show estimated costs"
                detail="Display API-equivalent values next to token usage. Estimates are computed locally."
                control={
                  <div className="flex items-center gap-2">
                    <EstimatedTag />
                    <Switch
                      checked={settings.showCosts}
                      onChange={(next) => updateSettings({ showCosts: next })}
                      label="Show estimated costs"
                    />
                  </div>
                }
              />
              <SettingRow
                title="Reduce motion"
                detail="Quiet chart and panel transitions. Useful if motion feels distracting."
                control={
                  <Switch
                    checked={settings.reduceMotion}
                    onChange={(next) => updateSettings({ reduceMotion: next })}
                    label="Reduce motion"
                  />
                }
              />
              <SettingRow
                title="Show sidebar labels"
                detail="Names and session counts next to each icon. Narrow windows always show icons only."
                control={
                  <Switch
                    checked={settings.sidebarExpanded}
                    onChange={toggleSidebar}
                    label="Show sidebar labels"
                  />
                }
              />
            </div>
          </section>

          <section id="defaults" className="card p-5 sm:p-6">
            <SectionHeading
              icon={<SlidersHorizontal className="h-4 w-4" />}
              title="Defaults"
              detail="Start exports and estimates the way you like them."
            />
            <div className="mt-4 divide-y divide-line/[0.06]">
              <SettingRow
                title="Default export format"
                detail="Preselected when you export one or more sessions."
                control={
                  <Segmented<ExportFormat>
                    value={settings.defaultExport}
                    onChange={(value) => updateSettings({ defaultExport: value })}
                    options={[
                      { value: "markdown", label: "Markdown" },
                      { value: "json", label: "JSON" },
                    ]}
                    compact
                    className="bg-sunken/60"
                  />
                }
              />
              <SettingRow
                title="Cost method"
                detail="Public API list prices, stored locally. Nothing is fetched."
                control={
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2.5 text-11"
                    onClick={() => openDialog({ kind: "explain-costs" })}
                  >
                    Review prices
                  </Button>
                }
              />
            </div>
          </section>
        </div>
      )}
      {section === "agents" && (
        <div className="flex max-w-[900px] flex-col gap-3.5">
          <section className="card p-5 sm:p-6">
            <SectionHeading icon={<Database className="h-4 w-4" />} title="Agents" detail="Choose which agents are included in your library." />
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-11 font-medium uppercase tracking-[0.1em] text-faint">
                  Agents
                </span>
                <span className="text-11 text-faint">
                  {enabled.length} included · {activeAgents} of {AGENT_ORDER.length} detected
                </span>
              </div>
              <div className="divide-y divide-line/[0.055] overflow-hidden rounded-[14px] border border-line/[0.075]">
                {AGENT_ORDER.map((agent) => {
                  const detection = detections.find((item) => item.id === agent);
                  const count = detection?.sessionCount ?? sessions.filter((session) => session.agent === agent).length;
                  const size = sessions
                    .filter((session) => session.agent === agent)
                    .reduce((sum, session) => sum + session.sizeBytes, 0);
                  const available = detection?.available ?? count > 0;
                  const root = detection?.roots[0] ?? AGENTS[agent].defaultRoot;
                  return (
                    <div key={agent} className="flex items-center gap-2.5 bg-panel px-3 py-2.5">
                      <span
                        className={`${AGENT_CLASS[agent]} flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--agent-soft)] text-[var(--agent-ink)]`}
                      >
                        <AgentMark agent={agent} className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-11 font-medium text-fg/85">
                            {AGENTS[agent].name}
                          </span>
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              available ? "bg-success-solid" : "bg-line/20",
                            )}
                          />
                          <span className="text-11 text-faint">
                            {available ? "detected" : "not found"}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate font-mono text-11 text-faint">{root}</div>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <div className="text-11 tabular text-muted">{number(count)} sessions</div>
                        <div className="text-11 tabular text-faint">{enabled.includes(agent) ? bytes(size) : "Not included"}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void revealLocation(root, AGENTS[agent].name)}
                        aria-label={`Reveal ${AGENTS[agent].name} storage`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-line/[0.055] hover:text-fg"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                      <Switch
                        checked={enabled.includes(agent)}
                        // Keep at least one agent, or the library would be empty by choice.
                        disabled={loading || (enabled.length === 1 && enabled.includes(agent))}
                        onChange={(next) => toggleAgent(agent, next)}
                        label={`Include ${AGENTS[agent].name}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

          </section>
          <section id="project-folders" className="card p-5 sm:p-6">
            <SectionHeading
              icon={<FolderLock className="h-4 w-4" />}
              title="Project folders"
              detail="Used to name projects and group worktrees with their repository."
            />
            <div className="mt-4 divide-y divide-line/[0.06]">
              <SettingRow
                title="Look inside project folders"
                detail="Checks each session's folder for .git and package.json. Source files are never read. Off: projects use their folder name."
                control={
                  <Switch
                    checked={access.inspect}
                    disabled={loading}
                    onChange={(next) => void updateScanSettings({ projectAccess: { ...access, inspect: next } })}
                    label="Look inside project folders"
                  />
                }
              />
            </div>
            {access.inspect && platform() === "macos" && (
              <div className="mt-4">
                <div className="mb-2 px-1 text-11 font-medium uppercase tracking-[0.1em] text-faint">
                  Folders macOS protects
                </div>
                {folderAccess.length === 0 ? (
                  <p className="rounded-[14px] border border-line/[0.075] px-3 py-3 text-11 text-muted">
                    {native
                      ? "None of your sessions ran in Documents, Desktop, Downloads, iCloud Drive or an external drive."
                      : "The desktop app lists protected folders, such as Documents, that sessions ran in."}
                  </p>
                ) : (
                  <div className="divide-y divide-line/[0.055] overflow-hidden rounded-[14px] border border-line/[0.075]">
                    {folderAccess.map((folder) => {
                      const allowed = isAllowed(folder.path);
                      const denied = allowed && folder.status === "denied";
                      return (
                        <div key={folder.path} className="flex items-center gap-2.5 bg-panel px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-11 font-medium text-fg/85">{folder.name}</span>
                              <span className={cn("h-1.5 w-1.5 rounded-full", denied ? "bg-warning-solid" : allowed ? "bg-success-solid" : "bg-line/20")} />
                              <span className="text-11 text-faint">
                                {denied ? "blocked by macOS" : allowed ? "allowed" : "not read"}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate font-mono text-11 text-faint">
                              {folder.path} · {number(folder.sessions)} sessions
                            </div>
                          </div>
                          {denied && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-11"
                              onClick={() => void openFolderPrivacySettings().catch(() => undefined)}
                            >
                              Open System Settings
                            </Button>
                          )}
                          <Switch
                            checked={allowed}
                            disabled={loading}
                            onChange={(next) => setFolderAllowed(folder.path, next)}
                            label={`Read project folders in ${folder.name}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2 px-1 text-11 leading-relaxed text-faint">
                  Turning a folder on makes macOS ask once. If you chose Don't Allow before, turn it
                  on in System Settings → Privacy &amp; Security → Files and Folders → SessionPal.
                </p>
              </div>
            )}
          </section>

        </div>
      )}
      {section === "storage" && (
        <div className="max-w-[900px]">
          <section id="storage" className="card p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <SectionHeading
                icon={<HardDrives className="h-4 w-4" />}
                title="Storage"
                detail="Where SessionPal reads and where archives are written."
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowsClockwise className={cn("h-3.5 w-3.5", loading && "animate-spin")} />}
                onClick={() => void rescan()}
              >
                Rescan
              </Button>
            </div>

            <div className="mt-4 rounded-[14px] border border-line/[0.075] bg-sunken/40 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-11 font-medium uppercase tracking-[0.1em] text-faint">
                  Backup folder
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void copyPath(settings.backupFolder)}
                    className="flex h-6 items-center gap-1 rounded-full px-2 text-11 font-medium text-muted transition-colors hover:bg-line/[0.06] hover:text-fg"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => void revealLocation(settings.backupFolder, "Backup folder")}
                    className="flex h-6 items-center gap-1 rounded-full px-2 text-11 font-medium text-muted transition-colors hover:bg-line/[0.06] hover:text-fg"
                  >
                    <FolderOpen className="h-3 w-3" /> Reveal
                  </button>
                </span>
              </div>
              <div className="mt-1.5 break-all font-mono text-11 leading-relaxed text-fg/70">
                {homePath(settings.backupFolder)}
              </div>
              <p className="mt-1.5 text-11 text-faint">
                Managed by the desktop app. Archives are created only when you ask.
              </p>
            </div>

            <SearchIndexPanel
              native={native && !demo}
              onClear={async () => {
                await clearSearchIndex();
                notify("Search index cleared", "It is rebuilt from your conversations now.");
                await rescan();
              }}
            />

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-11 text-faint">
              <span className="flex items-center gap-1.5">
                <Database className="h-3 w-3" /> {bytes(totalStorage)} session files
              </span>
              <span className="flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> {bytes(totalBackupSize)} archives
              </span>
              <span className="flex items-center gap-1.5">
                <Info className="h-3 w-3" /> Last scan {relativeTime(lastScanAt)}
              </span>
            </div>
          </section>

        </div>
      )}
      {section === "privacy" && (
        <section className="card max-w-[1040px] overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
            <div className="flex max-w-[560px] items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-success/10 text-success">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-16 font-bold tracking-[-0.025em] text-fg">Your library stays yours</h2>
                <p className="mt-1 text-12 leading-relaxed text-muted">
                  SessionPal is designed to keep your conversations on this device.
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: "privacy" })}>
              Read the local data note <ArrowSquareOut className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ul className="grid grid-cols-1 border-t border-line/[0.07] sm:grid-cols-3 sm:divide-x sm:divide-line/[0.07]">
            {[
              { icon: <LockSimple className="h-4 w-4" />, title: "No account", detail: "Nothing to sign in to." },
              { icon: <CloudSlash className="h-4 w-4" />, title: "No network", detail: "Sessions never leave this device." },
              { icon: <ShieldCheck className="h-4 w-4" />, title: "No telemetry", detail: "No analytics, crash reports or update checks." },
            ].map((item) => (
              <li key={item.title} className="flex gap-3 border-b border-line/[0.07] px-5 py-4 last:border-b-0 sm:border-b-0 sm:px-6">
                <span className="mt-0.5 shrink-0 text-faint">{item.icon}</span>
                <div>
                  <div className="text-12 font-semibold text-fg">{item.title}</div>
                  <p className="mt-1 text-11 leading-relaxed text-muted">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-start gap-2 border-t border-line/[0.07] bg-sunken/30 px-5 py-3.5 text-11 leading-relaxed text-muted sm:px-6">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
            {demo
              ? "This preview uses sample data. The desktop app discovers sessions from your selected agents."
              : "Changing preferences never rewrites agent files."}
          </div>
        </section>
      )}
      {section === "about" && (
        <AboutSection
          mode={native ? (demo ? "Desktop · sample data" : "Desktop · local library") : "Browser preview"}
          onCopyDiagnostics={() => void copyDiagnostics()}
        />
      )}

    </PageScroll>
  );
}

function SectionHeading({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-line/[0.045] text-muted">
        {icon}
      </span>
      <div>
        <h2 className="text-14 font-bold tracking-[-0.025em] text-fg">{title}</h2>
        <p className="mt-0.5 text-11 text-muted">{detail}</p>
      </div>
    </div>
  );
}

function SettingRow({
  title,
  detail,
  control,
}: {
  title: string;
  detail: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-11 font-medium text-fg/85">{title}</div>
        <div className="mt-0.5 max-w-[400px] text-11 leading-relaxed text-muted">{detail}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ThemeCard({
  theme,
  label,
  active,
  onSelect,
}: {
  theme: ThemeSetting;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group relative rounded-[14px] border p-1.5 text-left transition-all duration-150 ease-silk",
        active
          ? "border-copper-500/55 bg-copper-500/[0.055] shadow-[0_0_0_2px_rgba(184,105,63,0.09)]"
          : "border-line/[0.08] hover:border-line/[0.16]",
      )}
    >
      <ThemePreview theme={theme} />
      <div className="flex items-center justify-between px-1 pb-0.5 pt-2">
        <span className="flex items-center gap-1.5 text-11 font-medium text-fg/85">
          {theme === "light" ? (
            <Sun className="h-3 w-3 text-faint" />
          ) : theme === "dark" ? (
            <Moon className="h-3 w-3 text-faint" />
          ) : (
            <Palette className="h-3 w-3 text-faint" />
          )}
          {label}
        </span>
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full transition-colors",
            active ? "bg-copper-500 text-white" : "border border-line/15 text-transparent",
          )}
        >
          <Check className="h-2.5 w-2.5" weight="bold" />
        </span>
      </div>
    </button>
  );
}

function ThemePreview({ theme }: { theme: ThemeSetting }) {
  const light = (
    <div className="flex h-full w-full overflow-hidden rounded-[9px] bg-[#f9f6f0]">
      <div className="flex w-[20%] flex-col items-center gap-1 bg-[#1a1713] py-2">
        <span className="h-2 w-2 rounded-[3px] bg-[#f3e8cd]" />
        <span className="mt-1 h-1 w-2.5 rounded-full bg-white/25" />
        <span className="h-1 w-2.5 rounded-full bg-white/12" />
        <span className="h-1 w-2.5 rounded-full bg-white/12" />
      </div>
      <div className="flex-1 p-1.5">
        <div className="h-1 w-6 rounded-full bg-[#2a251f]/30" />
        <div className="mt-1.5 flex gap-1">
          <div className="h-4 flex-1 rounded-[4px] bg-[#dce9ed]" />
          <div className="h-4 flex-1 rounded-[4px] bg-[#e0e8d7]" />
        </div>
        <div className="mt-1 flex gap-1">
          <div className="h-3 flex-[2] rounded-[4px] bg-[#f4ddd3]" />
          <div className="h-3 flex-1 rounded-[4px] bg-[#e9e2f2]" />
        </div>
      </div>
    </div>
  );
  const dark = (
    <div className="flex h-full w-full overflow-hidden rounded-[9px] bg-[#161514]">
      <div className="flex w-[20%] flex-col items-center gap-1 bg-[#100f0e] py-2">
        <span className="h-2 w-2 rounded-[3px] bg-[#f3e8cd]" />
        <span className="mt-1 h-1 w-2.5 rounded-full bg-white/18" />
        <span className="h-1 w-2.5 rounded-full bg-white/8" />
        <span className="h-1 w-2.5 rounded-full bg-white/8" />
      </div>
      <div className="flex-1 p-1.5">
        <div className="h-1 w-6 rounded-full bg-[#f1e9dd]/25" />
        <div className="mt-1.5 flex gap-1">
          <div className="h-4 flex-1 rounded-[4px] bg-[#1f2b2e]" />
          <div className="h-4 flex-1 rounded-[4px] bg-[#252c20]" />
        </div>
        <div className="mt-1 flex gap-1">
          <div className="h-3 flex-[2] rounded-[4px] bg-[#33251e]" />
          <div className="h-3 flex-1 rounded-[4px] bg-[#292334]" />
        </div>
      </div>
    </div>
  );
  return (
    <div className="h-[76px] w-full overflow-hidden rounded-[10px] border border-line/[0.06]">
      {theme === "system" ? (
        <div className="flex h-full w-full">
          <div className="h-full w-1/2">{light}</div>
          <div className="h-full w-1/2">{dark}</div>
        </div>
      ) : theme === "dark" ? (
        dark
      ) : (
        light
      )}
    </div>
  );
}

function AboutSection({
  mode,
  onCopyDiagnostics,
}: {
  mode: string;
  onCopyDiagnostics: () => void;
}) {
  const [latest, ...older] = RELEASES;
  const links = [
    { label: "SessionPal website", url: APP_INFO.websiteUrl, icon: <Globe className="h-4 w-4" /> },
    {
      label: "Source on GitHub",
      url: APP_INFO.repositoryUrl,
      icon: <GithubLogo className="h-4 w-4" />,
    },
    { label: `${APP_INFO.developer}'s website`, url: APP_INFO.developerUrl, icon: <UserCircle className="h-4 w-4" /> },
  ].filter((link) => link.url);

  return (
    <section id="about" className="card mt-3.5 scroll-mt-4 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex flex-col items-center border-b border-line/[0.06] px-6 py-7 text-center lg:border-b-0 lg:border-r">
          <BrandMark className="h-12 w-12 text-fg" />
          <h2 className="mt-3.5 text-18 font-bold tracking-[-0.03em] text-fg">{APP_INFO.name}</h2>
          <div className="mt-0.5 text-12 tabular text-muted">Version {APP_INFO.version}</div>
          <p className="mt-2.5 max-w-[230px] text-12 leading-relaxed text-muted">{APP_INFO.tagline}</p>

          <dl className="mt-4 w-full space-y-1.5 rounded-[12px] bg-sunken/40 px-3 py-2.5 text-left text-11">
            <AboutRow label="Developer" value={APP_INFO.developer} />
            <AboutRow label="License" value={APP_INFO.license} />
            <AboutRow label="Running as" value={mode} />
          </dl>

          {links.length > 0 && (
            <div className="mt-4 flex items-center justify-center gap-1.5">
              {links.map((link) => (
                <Tooltip key={link.label} label={link.label} side="top">
                  <button
                    type="button"
                    aria-label={link.label}
                    onClick={() => void openUrl(link.url)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.09] text-muted transition-colors hover:bg-sunken/60 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500"
                  >
                    {link.icon}
                  </button>
                </Tooltip>
              ))}
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            icon={<Copy className="h-3 w-3" />}
            onClick={onCopyDiagnostics}
          >
            Copy diagnostics
          </Button>

          <p className="mt-auto pt-4 text-11 text-faint">
            © {APP_INFO.copyrightYear} {APP_INFO.developer}
          </p>
        </div>

        <div className="min-w-0 px-5 py-5 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-14 font-bold tracking-[-0.025em] text-fg">Version history</h2>
            <span className="text-11 text-faint">
              {RELEASES.length} {RELEASES.length === 1 ? "release" : "releases"}
            </span>
          </div>

          {latest ? (
            <ol className="mt-3 space-y-2">
              <ReleaseEntry release={latest} installed={latest.version === APP_INFO.version} open />
              {older.map((release) => (
                <ReleaseEntry
                  key={release.version}
                  release={release}
                  installed={release.version === APP_INFO.version}
                />
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-12 text-muted">No releases recorded yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate font-medium text-fg/75">{value}</dd>
    </div>
  );
}

function ReleaseEntry({
  release,
  installed = false,
  open = false,
}: {
  release: Release;
  installed?: boolean;
  open?: boolean;
}) {
  return (
    <li>
      <details open={open} className="group rounded-[14px] border border-line/[0.07]">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[14px] px-3.5 py-2.5 transition-colors hover:bg-sunken/40 [&::-webkit-details-marker]:hidden">
          <CaretRight className="h-3 w-3 shrink-0 text-faint transition-transform group-open:rotate-90" />
          <span className="text-13 font-semibold tabular text-fg">Version {release.version}</span>
          {installed && <Badge tone="success">Installed</Badge>}
          <span className="ml-auto text-11 text-faint">{formatReleaseDate(release.date)}</span>
        </summary>
        <div className="space-y-3 px-3.5 pb-3.5 pl-[38px]">
          {release.summary && <p className="text-12 text-muted">{release.summary}</p>}
          {release.sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-11 font-semibold text-faint">{section.title}</h3>
              <ul className="mt-1.5 space-y-1">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-2 text-12 leading-relaxed text-fg/80">
                    <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-fg/30" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}

/** How much conversation text is searchable, and a way to clear the index. */
function SearchIndexPanel({ native, onClear }: { native: boolean; onClear: () => Promise<void> }) {
  const [status, setStatus] = useState<SearchIndexStatus | null>(null);
  const [clearing, setClearing] = useState(false);
  const building = status?.building ?? false;

  useEffect(() => {
    if (!native) return;
    let stopped = false;
    let timer = 0;
    const load = async () => {
      try {
        const next = await fetchSearchIndexStatus();
        if (stopped) return;
        setStatus(next);
        if (next.building) timer = window.setTimeout(load, 1500);
      } catch {
        // The panel is informational; leave it as it was.
      }
    };
    void load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [native, clearing]);

  const summary = !native
    ? "The preview searches its sample conversations."
    : !status
      ? "Checking…"
      : building && status.total > 0
        ? `Indexing ${number(status.done)} of ${number(status.total)} changed conversations…`
        : `${number(status.indexedSessions)} conversations · ${bytes(status.sizeBytes)}`;

  return (
    <div className="mt-3 rounded-[14px] border border-line/[0.075] bg-sunken/40 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-11 font-medium uppercase tracking-[0.1em] text-faint">
          <MagnifyingGlass className="h-3 w-3" />
          Conversation search
        </span>
        {native && (
          <button
            type="button"
            disabled={clearing || !status || status.indexedSessions === 0}
            onClick={async () => {
              setClearing(true);
              try {
                await onClear();
              } finally {
                setClearing(false);
              }
            }}
            className="flex h-6 items-center gap-1 rounded-full px-2 text-11 font-medium text-muted transition-colors hover:bg-line/[0.06] hover:text-fg disabled:pointer-events-none disabled:opacity-40"
          >
            <ArrowCounterClockwise className="h-3 w-3" /> Rebuild
          </button>
        )}
      </div>
      <div className="mt-1.5 text-12 font-medium text-fg/80" aria-live="polite">
        {summary}
      </div>
      <p className="mt-1 text-11 leading-relaxed text-faint">
        What you and the agents wrote is indexed on this device so search can find it. Tool output
        isn't included, and the index updates after each scan.
      </p>
    </div>
  );
}
