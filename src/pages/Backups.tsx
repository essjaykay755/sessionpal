import { useMemo } from "react";
import { motion } from "motion/react";
import {
  Archive,
  ArrowCounterClockwise,
  Copy,
  Export,
  FileZip,
  FolderOpen,
  HardDrives,
  Info,
  ShieldCheck,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { useApp } from "../lib/store";
import type { BackupRecord } from "../lib/types";
import { bytes, cn, homePath, number, relativeTime } from "../lib/utils";
import { Badge, Button, EmptyState, KebabMenu } from "../components/ui";
import { AgentMark } from "../components/Brand";
import { AGENT_CLASS, AGENTS, backupCoverage } from "../lib/agents";
import { PageHeader, PageScroll, SectionTitle } from "../components/PageChrome";
import {
  BackupStatusIcon,
  BackupTimeline,
  backupFreshness,
  backupHeadline,
} from "../components/BackupStatus";

export default function BackupsPage() {
  const {
    backups,
    sessions,
    createBackup,
    restoreBackup,
    exportBackup,
    deleteBackup,
    importBackup,
    openDialog,
    revealLocation,
    copyPath,
    settings,
    demo,
  } = useApp();

  const latest = backups[0] ?? null;
  const totalSize = useMemo(
    () => backups.reduce((sum, backup) => sum + backup.sizeBytes, 0),
    [backups],
  );
  const protectedSessions = latest?.sessionCount ?? 0;
  const freshness = backupFreshness(latest);
  const coverage = sessions.length ? Math.min(100, (protectedSessions / sessions.length) * 100) : 0;

  const menuItems = (backup: BackupRecord) => [
    {
      label: "Archive details",
      icon: <Info className="h-3.5 w-3.5" />,
      onSelect: () => openDialog({ kind: "backup-details", id: backup.id }),
    },
    {
      label: "Restore archive",
      icon: <ArrowCounterClockwise className="h-3.5 w-3.5" />,
      onSelect: () => openDialog({ kind: "restore-backup", id: backup.id }),
    },
    {
      label: "Export a copy",
      icon: <Export className="h-3.5 w-3.5" />,
      onSelect: () => void exportBackup(backup.id),
    },
    {
      label: "Reveal archive",
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      onSelect: () => void revealLocation(backup.path, backup.name),
    },
    {
      label: "Delete archive",
      icon: <Trash className="h-3.5 w-3.5" />,
      danger: true,
      onSelect: () => openDialog({ kind: "delete-backup", id: backup.id }),
    },
  ];

  return (
    <PageScroll>
      <PageHeader
        title="Backups"
        subtitle="Local ZIP archives of your sessions. Make one before a cleanup."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              className="hidden sm:inline-flex"
              onClick={() => void revealLocation(settings.backupFolder, "Backup folder")}
            >
              Backup folder
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<UploadSimple className="h-3.5 w-3.5" />}
              onClick={() => void importBackup()}
            >
              Import
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card flex flex-col p-5 xl:col-span-8">
          <div className="flex flex-wrap items-center gap-3.5">
            <BackupStatusIcon freshness={freshness} />
            <div className="min-w-0 flex-1">
              <h2 className="text-16 font-bold tracking-[-0.025em] text-fg">
                {backupHeadline(latest)}
              </h2>
              <p className="mt-0.5 truncate text-12 text-muted">
                {latest
                  ? `${number(latest.sessionCount)} sessions · ${bytes(latest.sizeBytes)} · ${number(latest.fileCount)} files`
                  : "Create an archive before you delete sessions or upgrade an agent."}
                {freshness === "stale" && " · Consider a fresh backup."}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {latest && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openDialog({ kind: "backup-details", id: latest.id })}
                >
                  View latest
                </Button>
              )}
              <Button
                variant="copper"
                size="sm"
                icon={<Archive className="h-3.5 w-3.5" />}
                onClick={() => openDialog({ kind: "create-backup" })}
              >
                Create backup
              </Button>
            </div>
          </div>

          <div className="mt-5 border-t border-line/[0.06] pt-4">
            <div className="mb-2 text-11 font-medium text-faint">Last 30 days</div>
            <BackupTimeline
              backups={backups}
              onSelect={(backup) => openDialog({ kind: "backup-details", id: backup.id })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3.5 self-start xl:col-span-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-13 font-bold tracking-[-0.02em]">This device</h2>
              <Badge tone="success" dot>
                Local
              </Badge>
            </div>
            <div className="mt-3 space-y-3">
              <FolderRow
                label="Backup folder"
                value={settings.backupFolder}
                onReveal={() => void revealLocation(settings.backupFolder, "Backup folder")}
                onCopy={() => void copyPath(settings.backupFolder)}
              />
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Archives" value={number(backups.length)} icon={<FileZip className="h-3.5 w-3.5" />} />
                <MiniStat label="On disk" value={bytes(totalSize)} icon={<HardDrives className="h-3.5 w-3.5" />} />
              </div>
              <div>
                <div className="flex items-center justify-between text-11 text-faint">
                  <span>Latest coverage</span>
                  <span className="tabular">{coverage.toFixed(0)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/[0.06]">
                  <motion.span
                    initial={false}
                    animate={{ width: `${coverage}%` }}
                    transition={{ duration: 0.12 }}
                    className="block h-full rounded-full bg-[#81976a]"
                  />
                </div>
                <div className="mt-1.5 text-11 text-faint">
                  {number(protectedSessions)} of {number(sessions.length)} current sessions
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-[18px] border border-line/[0.07] bg-sunken/35 p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#71855a] dark:text-[#a5bd8e]" />
            <div>
              <div className="text-11 font-semibold text-fg/85">No scheduled jobs</div>
              <p className="mt-0.5 text-11 leading-relaxed text-muted">
                Backups only happen when you ask. SessionPal never runs in the background or sends
                an archive anywhere.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-7">
        <SectionTitle subtitle="Every archive is a plain ZIP with a manifest and the original agent files.">
          Archive history
        </SectionTitle>

        <div className="card overflow-hidden">
          {backups.length === 0 ? (
            <EmptyState
              icon={<FileZip className="h-5 w-5" />}
              title="No backups yet"
              description="Create a local archive before deleting sessions or upgrading an agent. You can export it to another drive later."
              action={
                <Button
                  variant="copper"
                  size="sm"
                  icon={<Archive className="h-3.5 w-3.5" />}
                  onClick={() => openDialog({ kind: "create-backup" })}
                >
                  Create first backup
                </Button>
              }
            />
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1.5fr)_112px_minmax(0,1fr)_80px_84px_28px] gap-3 border-b border-line/[0.06] px-5 py-2.5 text-11 font-medium text-faint md:grid">
                <span>Archive</span>
                <span>Created</span>
                <span>Contents</span>
                <span className="text-right">Sessions</span>
                <span className="text-right">Size</span>
                <span />
              </div>
              <div className="divide-y divide-line/[0.055]">
                {backups.map((backup, index) => (
                  <motion.div
                    key={backup.id}
                    initial={false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.12 }}
                    className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_28px] items-center gap-3 px-3.5 py-3 transition-colors hover:bg-sunken/40 md:grid-cols-[minmax(0,1.5fr)_112px_minmax(0,1fr)_80px_84px_28px] md:px-5"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDialog({ kind: "backup-details", id: backup.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDialog({ kind: "backup-details", id: backup.id });
                      }
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-line/[0.045] text-muted">
                        <FileZip className="h-[17px] w-[17px]" />
                        {index === 0 && (
                          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#7f9664] ring-2 ring-panel" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-12 font-semibold text-fg/90">
                            {backup.name}
                          </span>
                          {index === 0 && (
                            <span className="shrink-0 rounded-full bg-[#e5ecdc] px-1.5 py-0.5 text-11 font-medium text-[#526b3f] dark:bg-[#293522] dark:text-[#b8cfa5]">
                              Latest
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-11 text-faint">
                          <span className="hidden truncate md:inline" title={backup.path}>
                            {backup.path.split(/[\\/]/).pop()}
                          </span>
                          <span className="md:hidden">{relativeTime(backup.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="hidden text-11 text-muted md:block">
                      {relativeTime(backup.createdAt)}
                      <div className="mt-0.5 text-11 text-faint">
                        {new Date(backup.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <div
                        className="flex -space-x-1"
                        aria-label={backup.agents.map((agent) => AGENTS[agent].name).join(", ")}
                      >
                        {backup.agents.map((agent) => (
                          <span
                            key={agent}
                            title={
                              backupCoverage(backup).archiveOnly.includes(agent)
                                ? `${AGENTS[agent].name} · archive only`
                                : AGENTS[agent].name
                            }
                            className={cn(
                              AGENT_CLASS[agent],
                              "flex h-6 w-6 items-center justify-center rounded-full bg-[var(--agent-soft)] text-[var(--agent-ink)] ring-2 ring-panel",
                            )}
                          >
                            <AgentMark agent={agent} className="h-3 w-3" />
                          </span>
                        ))}
                      </div>
                      <div className="mt-1 text-11 text-faint">
                        {number(backup.fileCount)} files
                        {(() => {
                          const { archiveOnly, canRestore } = backupCoverage(backup);
                          if (!archiveOnly.length) return null;
                          return canRestore ? " · partly archive only" : " · archive only";
                        })()}
                      </div>
                    </div>
                    <div className="hidden text-right text-11 tabular text-muted md:block">
                      {number(backup.sessionCount)}
                    </div>
                    <div className="hidden text-right text-11 tabular text-muted md:block">
                      {bytes(backup.sizeBytes)}
                    </div>
                    <div className="flex justify-end">
                      <KebabMenu items={menuItems(backup)} label={`Actions for ${backup.name}`} />
                    </div>
                  </motion.div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <p className="mt-3 flex items-start gap-2 px-1 text-11 leading-relaxed text-muted">
        <ArrowCounterClockwise className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
        Restoring writes back only files that are missing. Existing files are never replaced. To
        move an archive, use Export a copy from its menu.
      </p>

      {demo && (
        <div className="mt-4 flex items-center gap-2 rounded-[14px] border border-[#c9a25b]/20 bg-[#c9a25b]/[0.055] px-4 py-3 text-11 leading-relaxed text-[#7d5c24] dark:text-[#dcc28e]">
          <Info className="h-3.5 w-3.5 shrink-0" />
          The preview uses sample archive records. Creating or exporting one produces a real local
          ZIP with a manifest and sample transcripts. Native restores are simulated here.
        </div>
      )}
    </PageScroll>
  );
}

function FolderRow({
  label,
  value,
  onReveal,
  onCopy,
}: {
  label: string;
  value: string;
  onReveal: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-[12px] border border-line/[0.07] bg-sunken/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-11 font-medium text-faint">{label}</span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy backup folder path"
            className="flex h-6 w-6 items-center justify-center rounded-full text-faint transition-colors hover:bg-line/[0.06] hover:text-fg"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onReveal}
            aria-label="Reveal backup folder"
            className="flex h-6 w-6 items-center justify-center rounded-full text-faint transition-colors hover:bg-line/[0.06] hover:text-fg"
          >
            <FolderOpen className="h-3 w-3" />
          </button>
        </span>
      </div>
      <div className="mt-1 break-all font-mono text-11 leading-relaxed text-muted">{homePath(value)}</div>
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-[11px] bg-sunken/45 px-2.5 py-2">
      <div className="flex items-center gap-1 text-11 text-faint">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-12 font-bold tabular tracking-[-0.02em] text-fg/85">{value}</div>
    </div>
  );
}
