import { useMemo } from "react";
import { ClockCounterClockwise, ShieldCheck, Warning } from "@phosphor-icons/react";
import type { BackupRecord } from "../lib/types";
import { bytes, cn, relativeTime } from "../lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_DAYS = 7;

export type BackupFreshness = "none" | "recent" | "stale";

export function backupFreshness(latest: BackupRecord | null | undefined): BackupFreshness {
  if (!latest) return "none";
  const age = Date.now() - new Date(latest.createdAt).getTime();
  return age > STALE_AFTER_DAYS * DAY_MS ? "stale" : "recent";
}

export function backupHeadline(latest: BackupRecord | null | undefined): string {
  return latest ? `Backed up ${relativeTime(latest.createdAt)}` : "No backups yet";
}

const TILE_TONE: Record<BackupFreshness, string> = {
  recent: "bg-success-soft text-success-ink",
  stale: "bg-warning-soft text-warning-ink",
  none: "bg-line/[0.06] text-muted",
};

/** A status icon in the style of a system settings pane. */
export function BackupStatusIcon({
  freshness,
  size = "md",
}: {
  freshness: BackupFreshness;
  size?: "sm" | "md";
}) {
  const Icon =
    freshness === "recent" ? ShieldCheck : freshness === "stale" ? Warning : ClockCounterClockwise;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "md" ? "h-11 w-11 rounded-[13px]" : "h-9 w-9 rounded-[11px]",
        TILE_TONE[freshness],
      )}
    >
      <Icon className={size === "md" ? "h-[22px] w-[22px]" : "h-[18px] w-[18px]"} weight="fill" />
    </span>
  );
}

/**
 * One column per day, newest on the right. A day with an archive gets a bar
 * sized by the largest archive made that day.
 */
export function BackupTimeline({
  backups,
  days = 30,
  onSelect,
  className,
}: {
  backups: BackupRecord[];
  days?: number;
  onSelect?: (backup: BackupRecord) => void;
  className?: string;
}) {
  const columns = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = today.getTime() - (days - 1) * DAY_MS;
    const slots: (BackupRecord[] | null)[] = Array.from({ length: days }, () => null);
    for (const backup of backups) {
      const created = new Date(backup.createdAt);
      created.setHours(0, 0, 0, 0);
      const index = Math.round((created.getTime() - start) / DAY_MS);
      if (index < 0 || index >= days) continue;
      (slots[index] ??= []).push(backup);
    }
    return slots.map((group, index) => ({
      date: new Date(start + index * DAY_MS),
      backup: group?.reduce((largest, item) => (item.sizeBytes > largest.sizeBytes ? item : largest)),
      count: group?.length ?? 0,
    }));
  }, [backups, days]);

  const largest = Math.max(1, ...columns.map((column) => column.backup?.sizeBytes ?? 0));
  const inRange = columns.reduce((sum, column) => sum + column.count, 0);

  return (
    <div className={className}>
      <div className="flex h-10 items-end gap-[3px]" role="list" aria-label={`Backups in the last ${days} days`}>
        {columns.map(({ date, backup, count }) => {
          const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          if (!backup) {
            return (
              <span
                key={date.getTime()}
                role="listitem"
                aria-label={`${label}: no backup`}
                className="flex h-full flex-1 items-end justify-center"
              >
                <span className="h-1 w-full max-w-[8px] rounded-full bg-line/[0.09]" />
              </span>
            );
          }
          const height = 30 + (backup.sizeBytes / largest) * 70;
          const title = `${label} · ${backup.name} · ${bytes(backup.sizeBytes)}${
            count > 1 ? ` (+${count - 1} more)` : ""
          }`;
          return (
            <button
              key={date.getTime()}
              type="button"
              role="listitem"
              title={title}
              aria-label={title}
              onClick={() => onSelect?.(backup)}
              className="group flex h-full flex-1 items-end justify-center rounded-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success-solid"
            >
              <span
                style={{ height: `${height}%` }}
                className="w-full max-w-[8px] rounded-full bg-success-solid transition-opacity group-hover:opacity-75"
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-11 text-faint">
        <span>{days} days ago</span>
        <span>
          {inRange} {inRange === 1 ? "backup" : "backups"}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
