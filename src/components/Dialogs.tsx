import { useEffect, useMemo, useState, type ReactNode } from "react";
import { trashName } from "../lib/native";
import {
  Archive,
  ArrowCounterClockwise,
  Check,
  CheckCircle,
  Database,
  Export,
  FileZip,
  FolderOpen,
  HardDrives,
  Info,
  ShieldCheck,
  Coins,
  Trash,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import { AGENTS, AGENT_CLASS, AGENT_ORDER, agentList, backupCoverage } from "../lib/agents";
import { knownModelInfo, modelInfo, modelPriceSource } from "../lib/pricing";
import { livePricesUpdatedAt } from "../lib/live-pricing";
import { useApp } from "../lib/store";
import type { AgentId, BackupRecord, ExportFormat, SessionSummary } from "../lib/types";
import { bytes, cn, compact, filenameStamp, fullDate, money, number, relativeTime } from "../lib/utils";
import { AgentMark } from "./Brand";
import {
  AgentBadge,
  Badge,
  Button,
  EstimatedTag,
  InfoNote,
  Modal,
  Segmented,
  Switch,
} from "./ui";

export function DialogHost() {
  const { dialog, closeDialog } = useApp();
  return (
    <>
      <CreateBackupDialog open={dialog?.kind === "create-backup"} onClose={closeDialog} />
      <ExportSessionsDialog
        open={dialog?.kind === "export-sessions"}
        ids={dialog?.kind === "export-sessions" ? dialog.ids : []}
        label={dialog?.kind === "export-sessions" ? dialog.label : undefined}
        onClose={closeDialog}
      />
      <DeleteSessionsDialog
        open={dialog?.kind === "delete-sessions"}
        ids={dialog?.kind === "delete-sessions" ? dialog.ids : []}
        onClose={closeDialog}
      />
      <RestoreBackupDialog
        open={dialog?.kind === "restore-backup"}
        id={dialog?.kind === "restore-backup" ? dialog.id : null}
        onClose={closeDialog}
      />
      <BackupDetailsDialog
        open={dialog?.kind === "backup-details"}
        id={dialog?.kind === "backup-details" ? dialog.id : null}
        onClose={closeDialog}
      />
      <DeleteBackupDialog
        open={dialog?.kind === "delete-backup"}
        id={dialog?.kind === "delete-backup" ? dialog.id : null}
        onClose={closeDialog}
      />
      <ExplainCostsDialog open={dialog?.kind === "explain-costs"} onClose={closeDialog} />
      <PrivacyDialog open={dialog?.kind === "privacy"} onClose={closeDialog} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Create backup                                                       */
/* ------------------------------------------------------------------ */

function defaultBackupName(): string {
  const now = new Date();
  return `Backup · ${now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function CreateBackupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { sessions, createBackup, closeDialog, demo } = useApp();
  const [name, setName] = useState(defaultBackupName);
  const [agents, setAgents] = useState<AgentId[]>([...AGENT_ORDER]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultBackupName());
    setAgents([...AGENT_ORDER]);
    setSaving(false);
    setError(null);
  }, [open]);

  const scoped = useMemo(
    () => sessions.filter((session) => agents.includes(session.agent)),
    [agents, sessions],
  );
  const totalSize = useMemo(
    () => scoped.reduce((sum, session) => sum + session.sizeBytes, 0),
    [scoped],
  );

  const toggleAgent = (agent: AgentId) => {
    setAgents((current) =>
      current.includes(agent)
        ? current.filter((value) => value !== agent)
        : [...current, agent],
    );
  };

  const submit = async () => {
    if (!agents.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createBackup(name, agents);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The backup could not be created.");
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title="Create a local backup"
      description="Every selected session is written to one archive in your backup folder. Nothing is uploaded."
      icon={<Archive className="h-5 w-5" />}
      width="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="copper"
            size="sm"
            icon={<Archive className="h-3.5 w-3.5" />}
            loading={saving}
            disabled={agents.length === 0}
            onClick={() => void submit()}
          >
            {saving ? "Building archive…" : "Create backup"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-12 font-medium text-muted">Backup name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={72}
            placeholder={defaultBackupName()}
            className="h-10 w-full rounded-[12px] border border-line/[0.1] bg-raised px-3.5 text-13 text-fg outline-none transition-colors placeholder:text-faint focus:border-copper-500/45 focus:ring-2 focus:ring-copper-500/10"
          />
        </label>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-12 font-medium text-muted">Include agents</span>
            <button
              type="button"
              onClick={() =>
                setAgents(agents.length === AGENT_ORDER.length ? [] : [...AGENT_ORDER])
              }
              className="text-11 font-medium text-copper-600 transition-colors hover:text-copper-700 dark:text-copper-300 dark:hover:text-copper-200"
            >
              {agents.length === AGENT_ORDER.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AGENT_ORDER.map((agent) => {
              const count = sessions.filter((session) => session.agent === agent).length;
              const checked = agents.includes(agent);
              return (
                <button
                  key={agent}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleAgent(agent)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[14px] border px-3 py-2.5 text-left transition-colors",
                    checked
                      ? "border-copper-500/30 bg-copper-500/[0.055]"
                      : "border-line/[0.08] bg-raised hover:bg-sunken/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors",
                      checked
                        ? "border-copper-500 bg-copper-500 text-white"
                        : "border-line/20 bg-panel",
                    )}
                  >
                    {checked && <Check className="h-3 w-3" weight="bold" />}
                  </span>
                  <span className={`${AGENT_CLASS[agent]} text-[var(--agent)]`}>
                    <AgentMark agent={agent} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-12 font-medium text-fg">
                      {AGENTS[agent].name}
                    </span>
                    <span className="block text-11 text-faint">
                      {number(count)} sessions · {AGENTS[agent].storageKind}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[16px] border border-line/[0.075] bg-sunken/45 p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-12 text-muted">Archive contents</span>
            <Badge tone={agents.length ? "copper" : "warning"}>
              {number(scoped.length)} sessions · {bytes(Math.round(totalSize * 0.34))} est.
            </Badge>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {agents.length ? (
              agents.map((agent) => <AgentBadge key={agent} agent={agent} compact />)
            ) : (
              <span className="text-11 text-warning">
                Choose at least one agent to continue.
              </span>
            )}
          </div>
          <p className="mt-3 text-11 leading-relaxed text-faint">
            SessionPal writes a manifest next to the original files inside the archive, so a restore
            can be validated before anything is overwritten.
          </p>
        </div>

        {demo && (
          <InfoNote icon={<Info className="h-3.5 w-3.5" />}>
            You're in the browser preview. This creates a sample archive entry locally in the
            preview library. The desktop build zips the real files from disk.
          </InfoNote>
        )}
        {error && (
          <InfoNote className="border-danger/20 text-danger" icon={<WarningCircle className="h-3.5 w-3.5" />}>
            {error}
          </InfoNote>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Export sessions                                                     */
/* ------------------------------------------------------------------ */

function ExportSessionsDialog({
  open,
  ids,
  label,
  onClose,
}: {
  open: boolean;
  ids: string[];
  label?: string;
  onClose: () => void;
}) {
  const { sessions, settings, exportSessions, demo } = useApp();
  const [format, setFormat] = useState<ExportFormat>(settings.defaultExport);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormat(settings.defaultExport);
    setWorking(false);
  }, [open, settings.defaultExport]);

  const selected = useMemo(
    () => sessions.filter((session) => ids.includes(session.id)),
    [ids, sessions],
  );
  const totalSize = selected.reduce((sum, session) => sum + session.sizeBytes, 0);

  const submit = async () => {
    setWorking(true);
    try {
      const result = await exportSessions(ids, format);
      if (!result.cancelled) onClose();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onClose}
      title={selected.length === 1 ? "Export session" : "Export sessions"}
      description={
        selected.length === 1
          ? "Write a readable copy of this conversation to disk."
          : `Write ${selected.length} conversations into one ${format === "json" ? "JSON" : "Markdown"} file.`
      }
      icon={<Export className="h-5 w-5" />}
      width="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button
            variant="copper"
            size="sm"
            icon={<Export className="h-3.5 w-3.5" />}
            loading={working}
            onClick={() => void submit()}
          >
            {demo ? "Download sample export" : "Choose destination…"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-1.5 text-12 font-medium text-muted">Format</div>
          <Segmented
            value={format}
            onChange={setFormat}
            options={[
              { value: "markdown", label: "Markdown" },
              { value: "json", label: "JSON" },
            ]}
            className="bg-sunken/70"
          />
          <p className="mt-2 text-11 leading-relaxed text-faint">
            {format === "markdown"
              ? "Readable archive with a compact metadata header, role headings, and tool calls. Good for long-term reading."
              : "Lossless session objects, including messages, usage, and source metadata. Good for scripts and re-imports."}
          </p>
        </div>

        <div className="overflow-hidden rounded-[16px] border border-line/[0.075]">
          <div className="flex items-center justify-between gap-3 border-b border-line/[0.065] bg-sunken/40 px-4 py-2.5">
            <span className="text-11 font-medium text-muted">
              {selected.length === 1 ? (label ?? selected[0]?.title) : `${selected.length} sessions`}
            </span>
            <span className="text-11 tabular text-faint">{bytes(totalSize)} source</span>
          </div>
          <div className="max-h-[188px] divide-y divide-line/[0.055] overflow-y-auto">
            {selected.slice(0, 40).map((session) => (
              <div key={session.id} className="flex items-center gap-2.5 px-4 py-2">
                <AgentBadge agent={session.agent} compact />
                <span className="min-w-0 flex-1 truncate text-12 text-fg/85">
                  {session.title}
                </span>
                <span className="shrink-0 text-11 text-faint">{session.projectLabel}</span>
              </div>
            ))}
            {selected.length > 40 && (
              <div className="px-4 py-2 text-11 text-faint">
                and {number(selected.length - 40)} more sessions…
              </div>
            )}
          </div>
        </div>

        <InfoNote icon={<ShieldCheck className="h-3.5 w-3.5" />}>
          {demo
            ? "The preview downloads a file through the browser. The desktop app opens a native save dialog and writes directly to the location you choose."
            : "The export is written only to the location you choose. SessionPal does not keep a copy."}
        </InfoNote>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Delete sessions                                                     */
/* ------------------------------------------------------------------ */

function DeleteSessionsDialog({
  open,
  ids,
  onClose,
}: {
  open: boolean;
  ids: string[];
  onClose: () => void;
}) {
  const { sessions, deleteSessions, demo } = useApp();
  const [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAcknowledged(false);
    setWorking(false);
    setError(null);
  }, [open]);

  const selected = useMemo(
    () => sessions.filter((session) => ids.includes(session.id)),
    [ids, sessions],
  );
  const deletable = selected.filter((session) => session.deletable);
  const skipped = selected.length - deletable.length;
  const reclaimed = deletable.reduce((sum, session) => sum + session.sizeBytes, 0);

  const submit = async () => {
    if (!acknowledged || working) return;
    setWorking(true);
    setError(null);
    try {
      await deleteSessions(ids);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The sessions could not be deleted.");
      setWorking(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onClose}
      title={deletable.length === 1 ? "Delete this session?" : `Delete ${deletable.length} sessions?`}
      description={`The original files move to your ${trashName()}, so you can put them back from there until it is emptied. There is no cloud copy.`}
      icon={<Trash className="h-5 w-5" />}
      width="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={working}>
            Keep sessions
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash className="h-3.5 w-3.5" />}
            disabled={!acknowledged || deletable.length === 0}
            loading={working}
            onClick={() => void submit()}
          >
            {deletable.length === 1 ? "Delete session" : `Delete ${deletable.length} sessions`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-[16px] border border-line/[0.075] bg-sunken/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-12 text-muted">Selected for removal</span>
            <span className="text-12 font-semibold tabular text-fg">
              {number(deletable.length)} files · {bytes(reclaimed)}
            </span>
          </div>
          <div className="mt-2.5 max-h-[160px] divide-y divide-line/[0.055] overflow-y-auto rounded-[10px] border border-line/[0.06] bg-panel/70">
            {deletable.slice(0, 24).map((session) => (
              <div key={session.id} className="flex items-center gap-2.5 px-3 py-2">
                <AgentBadge agent={session.agent} compact />
                <span className="min-w-0 flex-1 truncate text-12 text-fg/85">
                  {session.title}
                </span>
                <span className="shrink-0 text-11 tabular text-faint">
                  {bytes(session.sizeBytes)}
                </span>
              </div>
            ))}
            {deletable.length > 24 && (
              <div className="px-3 py-2 text-11 text-faint">
                and {number(deletable.length - 24)} more…
              </div>
            )}
            {deletable.length === 0 && (
              <div className="px-3 py-3 text-11 text-muted">
                Nothing here can be removed safely. Database-managed sessions are read-only.
              </div>
            )}
          </div>
        </div>

        {skipped > 0 && (
          <InfoNote icon={<Database className="h-3.5 w-3.5" />}>
            {skipped} selected {skipped === 1 ? "session lives" : "sessions live"} inside an agent's
            local database. SessionPal can read and export them, but it never edits that database,
            so {skipped === 1 ? "it" : "they"} will be skipped.
          </InfoNote>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-line/[0.08] bg-raised p-3.5 transition-colors hover:bg-sunken/40">
          <span className="mt-0.5">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border transition-colors",
                acknowledged
                  ? "border-danger-solid bg-danger-solid text-white"
                  : "border-line/20 bg-panel",
              )}
            >
              {acknowledged && <Check className="h-3 w-3" weight="bold" />}
            </span>
          </span>
          <span className="text-12 leading-relaxed text-muted">
            I understand these original files will be removed from this device
            {demo ? " (in the preview library)" : ""}.
          </span>
        </label>

        {error && (
          <InfoNote className="border-danger/20 text-danger" icon={<WarningCircle className="h-3.5 w-3.5" />}>
            {error}
          </InfoNote>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Restore backup                                                      */
/* ------------------------------------------------------------------ */

function RestoreBackupDialog({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { backups, restoreBackup } = useApp();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backup = backups.find((item) => item.id === id) ?? null;
  const coverage = backup ? backupCoverage(backup) : null;

  useEffect(() => {
    if (!open) return;
    setWorking(false);
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!backup || working) return;
    setWorking(true);
    setError(null);
    try {
      await restoreBackup(backup.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The backup could not be restored.");
      setWorking(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onClose}
      title="Restore this backup?"
      description="Missing session files are copied back to their original agent folders. Files that are already on disk are never overwritten."
      icon={<ArrowCounterClockwise className="h-5 w-5" />}
      width="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button
            variant="copper"
            size="sm"
            icon={<ArrowCounterClockwise className="h-3.5 w-3.5" />}
            loading={working}
            onClick={() => void submit()}
            disabled={!backup || !coverage?.canRestore}
          >
            {working ? "Restoring…" : "Restore backup"}
          </Button>
        </>
      }
    >
      {backup && (
        <div className="space-y-4">
          <div className="rounded-[16px] border border-line/[0.075] bg-sunken/40 p-4">
            <div className="text-13 font-semibold tracking-[-0.02em] text-fg">{backup.name}</div>
            <div className="mt-1 text-11 text-muted">
              {fullDate(backup.createdAt)} · {number(backup.sessionCount)} sessions ·{" "}
              {bytes(backup.sizeBytes)}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {backup.agents.map((agent) => (
                <AgentBadge key={agent} agent={agent} compact />
              ))}
            </div>
          </div>

          {coverage && coverage.archiveOnly.length > 0 && (
            <InfoNote icon={<Database className="h-3.5 w-3.5" />}>
              {coverage.canRestore
                ? `${agentList(coverage.archiveOnly)} conversations in this backup are archive-only. They stay in the archive for inspection and export, but restore can't put them back into ${coverage.archiveOnly.length === 1 ? "that app" : "those apps"}.`
                : `Everything in this backup is archive-only: ${agentList(coverage.archiveOnly)} conversations come from a live database SessionPal never writes to. Open the archive to inspect or export them.`}
            </InfoNote>
          )}

          <div className="space-y-2.5">
            <SafetyRow
              icon={<Archive className="h-3.5 w-3.5" />}
              title="Nothing is overwritten"
              detail="If a session still exists, including one that continued after this backup, the copy on disk is kept."
            />
            <SafetyRow
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              title="Archive paths are validated"
              detail="Entries must map to a known agent root. Paths with traversal are rejected."
            />
            <SafetyRow
              icon={<Database className="h-3.5 w-3.5" />}
              title="Agent databases stay read-only"
              detail="Cursor, OpenCode and Antigravity chats are kept in the archive for reference, but their live databases are never written to."
            />
          </div>

          <InfoNote>
            Use restore to bring back sessions that were deleted. To roll a session back to an older
            version, delete it first, then restore.
          </InfoNote>

          {error && (
            <InfoNote className="border-danger/20 text-danger" icon={<WarningCircle className="h-3.5 w-3.5" />}>
              {error}
            </InfoNote>
          )}
        </div>
      )}
    </Modal>
  );
}

function SafetyRow({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-line/[0.045] text-muted">
        {icon}
      </span>
      <div>
        <div className="text-12 font-medium text-fg/85">{title}</div>
        <div className="mt-0.5 text-11 leading-relaxed text-muted">{detail}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Backup details / delete                                             */
/* ------------------------------------------------------------------ */

function BackupDetailsDialog({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { backups, exportBackup, openDialog, copyPath, revealLocation, demo } = useApp();
  const [working, setWorking] = useState(false);
  const backup = backups.find((item) => item.id === id) ?? null;

  useEffect(() => {
    if (!open) return;
    setWorking(false);
  }, [open]);

  const rows: Array<{ label: string; value: ReactNode }> = backup
    ? [
        { label: "Created", value: fullDate(backup.createdAt) },
        { label: "Sessions", value: number(backup.sessionCount) },
        { label: "Files in archive", value: number(backup.fileCount) },
        { label: "Archive size", value: bytes(backup.sizeBytes) },
        {
          label: "Restore",
          value: (() => {
            const { archiveOnly, canRestore } = backupCoverage(backup);
            if (!archiveOnly.length) return "Fully restorable";
            if (!canRestore) return "Archive only";
            return `Restorable · ${agentList(archiveOnly)} archive only`;
          })(),
        },
        {
          label: "Agents",
          value: (
            <div className="flex flex-wrap justify-end gap-1">
              {backup.agents.map((agent) => (
                <AgentBadge key={agent} agent={agent} compact />
              ))}
            </div>
          ),
        },
        { label: "Archive path", value: <span className="break-all font-mono text-11">{backup.path}</span> },
      ]
    : [];

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onClose}
      title={backup?.name ?? "Backup details"}
      description="Everything in this archive is stored on this device."
      icon={<FileZip className="h-5 w-5" />}
      width="lg"
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash className="h-3.5 w-3.5" />}
            className="mr-auto text-danger hover:bg-danger/[0.08]"
            onClick={() => backup && openDialog({ kind: "delete-backup", id: backup.id })}
          >
            Delete
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            onClick={() => backup && void revealLocation(backup.path, backup.name)}
          >
            Reveal
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Export className="h-3.5 w-3.5" />}
            loading={working}
            onClick={async () => {
              if (!backup) return;
              setWorking(true);
              try {
                await exportBackup(backup.id);
              } finally {
                setWorking(false);
              }
            }}
          >
            Export
          </Button>
          <Button
            variant="copper"
            size="sm"
            icon={<ArrowCounterClockwise className="h-3.5 w-3.5" />}
            onClick={() => backup && openDialog({ kind: "restore-backup", id: backup.id })}
          >
            Restore
          </Button>
        </>
      }
    >
      {backup && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-[16px] border border-line/[0.075]">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={cn(
                  "flex items-center justify-between gap-6 px-4 py-2.5",
                  index !== 0 && "border-t border-line/[0.055]",
                )}
              >
                <span className="shrink-0 text-11 text-muted">{row.label}</span>
                <span className="text-right text-12 font-medium text-fg/85">{row.value}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="soft"
              size="sm"
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              onClick={() => void revealLocation(backup.path, backup.name)}
            >
              Open location
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copyPath(backup.path)}
            >
              Copy path
            </Button>
          </div>

          {backup.demo && (
            <InfoNote icon={<Info className="h-3.5 w-3.5" />}>
              This is a sample archive record. Export downloads a small real ZIP with a manifest and
              sample transcripts; the desktop build archives your full session files.
            </InfoNote>
          )}
          {demo && (
            <InfoNote>
              Restores in the preview are simulated. The desktop app stages the archive, validates
              every path, then writes back only the files that are missing.
            </InfoNote>
          )}
        </div>
      )}
    </Modal>
  );
}

function DeleteBackupDialog({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { backups, deleteBackup } = useApp();
  const [working, setWorking] = useState(false);
  const backup = backups.find((item) => item.id === id) ?? null;

  useEffect(() => {
    if (!open) return;
    setWorking(false);
  }, [open]);

  const submit = async () => {
    if (!backup) return;
    setWorking(true);
    try {
      await deleteBackup(backup.id);
      onClose();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onClose}
      title="Delete this backup?"
      description={`The archive moves to your ${trashName()}. Your current sessions are not affected.`}
      icon={<Trash className="h-5 w-5" />}
      width="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash className="h-3.5 w-3.5" />}
            loading={working}
            onClick={() => void submit()}
          >
            Delete archive
          </Button>
        </>
      }
    >
      {backup && (
        <div className="rounded-[16px] border border-line/[0.075] bg-sunken/40 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-line/[0.05] text-muted">
              <FileZip className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-12 font-semibold text-fg">{backup.name}</div>
              <div className="mt-0.5 text-11 text-faint">
                {number(backup.sessionCount)} sessions · {bytes(backup.sizeBytes)} ·{" "}
                {relativeTime(backup.createdAt)}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Explain costs                                                       */
/* ------------------------------------------------------------------ */

function ExplainCostsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, updateSettings, sessions } = useApp();
  const usedModels = new Map<string, Set<AgentId>>();
  for (const session of sessions) {
    const ids = new Set([...(session.models ?? []), session.model].filter((id): id is string => !!id));
    for (const id of ids) {
      const agents = usedModels.get(id) ?? new Set<AgentId>();
      agents.add(session.agent);
      usedModels.set(id, agents);
    }
  }
  const rows = Array.from(usedModels, ([id, agents]) => ({ id, agents, info: modelInfo(id), price: knownModelInfo(id), source: modelPriceSource(id) }))
    .sort((a, b) => a.info.label.localeCompare(b.info.label));
  const hasHaiku = rows.some(({ id }) => /^claude-haiku-5-5(?:-\d{8})?$/.test(id));
  const updatedAt = livePricesUpdatedAt();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How cost estimates work"
      description="SessionPal computes every figure locally from token counts in your session files and public API list prices."
      icon={<Coins className="h-5 w-5" />}
      width="xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => updateSettings({ showCosts: !settings.showCosts })}
          >
            {settings.showCosts ? "Hide cost estimates" : "Show cost estimates"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-[16px] border border-line/[0.075] bg-sunken/40 p-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-copper-500/[0.12] text-copper-600 dark:text-copper-300">
            <Info className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-13 font-semibold text-fg">API-equivalent value, not a bill</span>
              <EstimatedTag />
            </div>
            <p className="mt-1 text-12 leading-relaxed text-muted">
              Estimates use current short-context API rates, including paid equivalents of recognized free models. Rates refresh from models.dev and may differ by provider. Missing cache rates use the input rate. Subscription usage, discounts and long-context rates are not included.
            </p>
            <p className="mt-1 text-11 text-faint">{updatedAt ? `models.dev prices last updated: ${updatedAt}.` : "Online prices have not been loaded yet."}</p>
          </div>
        </div>

        <section>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h3 className="text-12 font-semibold text-fg">Models in your sessions</h3>
            <span className="text-11 text-faint">USD per million tokens</span>
          </div>
          <div className="overflow-hidden rounded-[16px] border border-line/[0.075]">
            <table className="w-full table-fixed text-12">
              <colgroup>
                <col />
                <col className="w-[84px] sm:w-[96px]" />
                <col className="w-[84px] sm:w-[96px]" />
                <col className="w-[84px] sm:w-[96px]" />
                <col className="w-[84px] sm:w-[96px]" />
              </colgroup>
              <thead className="bg-sunken/40 text-11 text-faint">
                <tr className="border-b border-line/[0.065]">
                  <th className="px-4 py-2.5 text-left font-medium">Model</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Input</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Output</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Cache read</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Cache write</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/[0.05]">
                  {rows.map(({ id, agents, info, price, source }) => (
                    <tr key={id}>
                      <td className="px-4 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: info.color }}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-fg/85" title={id}>{info.label}{/^claude-haiku-5-5(?:-\d{8})?$/.test(id) ? "*" : ""}</div>
                            <div className="truncate text-11 text-faint">{Array.from(agents, (agent) => AGENTS[agent].shortName).join(", ")} · {source === "models.dev" ? "models.dev" : source === "bundled" ? "Saved app rate" : "Unpriced"}</div>
                          </div>
                        </div>
                      </td>
                      <Price value={price?.input} />
                      <Price value={price?.output} />
                      <Price value={price?.cacheRead} />
                      <Price value={price?.cacheWrite} />
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={5} className="px-4 py-5 text-center text-muted">No models found in your sessions yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {hasHaiku && <p className="mt-2 px-1 text-11 text-faint">* Claude Haiku 5.5 estimates use base rates for prompts up to 100,000 tokens. Longer prompts have higher rates that are not included.</p>}
        </section>

        <section>
          <h3 className="mb-2 px-1 text-12 font-semibold text-fg">How figures are calculated</h3>
          <dl className="divide-y divide-line/[0.055] rounded-[16px] border border-line/[0.075]">
            <FormulaRow
              label="Estimated cost"
              formula="(input × in + output × out + cache read × read + cache write × write) ÷ 1M"
              detail="Each token category is priced at its own rate."
            />
            <FormulaRow
              label="Cache savings"
              formula="cache read × (input price − cache read price) ÷ 1M"
              detail="Gross cache-read savings; cache-write costs are not deducted."
            />
            <FormulaRow
              label="Tokens counted"
              formula="input + output + cache read + cache write"
              detail="Each category is counted once; cached input is never double-counted as regular input."
            />
          </dl>
        </section>

        <InfoNote icon={<ShieldCheck className="h-3.5 w-3.5" />}>
          Prices are stored locally and may change. Sessions with unknown prices or mixed models
          are excluded from cost totals; the usage page shows how many sessions are included.
        </InfoNote>
      </div>
    </Modal>
  );
}

/** Two decimals at least, more only when the rate needs them ($0.125). */
function formatRate(value: number): string {
  const fixed = value.toFixed(2);
  return Number(fixed) === value ? fixed : String(value);
}

function Price({ value }: { value?: number }) {
  return (
    <td className="py-2 pr-4 text-right tabular text-muted">
      {value == null ? "—" : `$${formatRate(value)}`}
    </td>
  );
}

function FormulaRow({
  label,
  formula,
  detail,
}: {
  label: string;
  formula: string;
  detail: string;
}) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[136px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-12 font-medium text-fg/85">{label}</dt>
      <dd className="min-w-0">
        <code className="block font-mono text-11 leading-[1.6] text-fg/75">{formula}</code>
        <p className="mt-1 text-11 leading-relaxed text-muted">{detail}</p>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

function PrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { demo, detections, sessions, backups, settings, updateSettings } = useApp();
  const active = detections.filter((detection) => detection.available).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your sessions stay yours"
      description="SessionPal is a local tool. There is no account, no sync, and no analytics."
      icon={<ShieldCheck className="h-5 w-5" />}
      width="lg"
      footer={
        <Button variant="primary" size="sm" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="rounded-[18px] bg-[var(--rail)] p-5 text-[#f3ebde] dark:border dark:border-white/[0.06] dark:bg-[var(--rail-elevated)]">
          <div className="flex items-center gap-2 text-11 font-medium text-[#f3ebde]/45">
            <span className="h-1.5 w-1.5 rounded-full bg-success-solid" />
            Local-first by design
          </div>
          <p className="mt-2 max-w-[440px] text-13 leading-[1.6] tracking-[-0.01em] text-[#f3ebde]/85">
            SessionPal reads the files your agents already wrote and keeps a private index in memory.
            Nothing leaves this device — not your prompts, not your code, not a usage beacon.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.07] pt-4">
            <PrivacyStat value={number(sessions.length)} label="sessions indexed" />
            <PrivacyStat value={number(active)} label="agents detected" />
            <PrivacyStat value={number(backups.length)} label="local archives" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-[15px] border border-line/[0.075] bg-raised p-4">
            <div className="flex items-center gap-2 text-12 font-semibold text-fg">
              <CheckCircle className="h-4 w-4 text-success" weight="fill" />
              What it reads
            </div>
            <ul className="mt-2.5 space-y-2 text-11 leading-relaxed text-muted">
              <li>Session files under the standard agent storage folders.</li>
              <li>Read-only access to Cursor, OpenCode and Antigravity databases.</li>
              <li>Your local backup folder, only when you ask.</li>
              <li>Appearance and path preferences in local storage.</li>
              <li>Public GitHub release information when checking for updates. Automatic checks can be disabled in Settings.</li>
            </ul>
          </div>
          <div className="rounded-[15px] border border-line/[0.075] bg-raised p-4">
            <div className="flex items-center gap-2 text-12 font-semibold text-fg">
              <Warning className="h-4 w-4 text-copper-500" weight="fill" />
              What it never does
            </div>
            <ul className="mt-2.5 space-y-2 text-11 leading-relaxed text-muted">
              <li>Upload conversations, prompts, or code.</li>
              <li>Create an account or send analytics.</li>
              <li>Send notifications or schedule background jobs.</li>
              <li>Write to another app's database.</li>
            </ul>
          </div>
        </div>

        {demo && (
          <InfoNote icon={<Info className="h-3.5 w-3.5" />}>
            You're exploring the browser preview, which uses a deterministic sample library so every
            surface is testable without touching your real files. In the desktop app, the same
            interface reads discovered sessions directly from disk.
          </InfoNote>
        )}

        <div className="flex items-center justify-between gap-4 rounded-[15px] border border-line/[0.075] bg-sunken/35 px-4 py-3">
          <div>
            <div className="text-12 font-medium text-fg/85">Show estimated costs</div>
            <div className="mt-0.5 text-11 text-muted">
              Computed locally from public list prices.
            </div>
          </div>
          <Switch
            checked={settings.showCosts}
            onChange={(next) => updateSettings({ showCosts: next })}
            label="Show estimated costs"
          />
        </div>
      </div>
    </Modal>
  );
}

function PrivacyStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-16 font-bold tabular tracking-[-0.03em]">{value}</div>
      <div className="mt-0.5 text-11 text-[#f3ebde]/38">{label}</div>
    </div>
  );
}
