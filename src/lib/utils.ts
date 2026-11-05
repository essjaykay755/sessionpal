export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function bytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  const decimals = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[exponent]}`;
}

export function compact(value: number): string {
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}k`;
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function trim(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(1);
}

export function number(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function money(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.01) return "< $0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function date(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function iso(value: string | number | Date): string {
  return new Date(value).toISOString();
}

export function relativeTime(value: string | Date, now = Date.now()): string {
  const delta = Math.max(0, now - date(value).getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "Yesterday" : `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function shortDate(value: string | Date, now = Date.now()): string {
  const target = date(value);
  const diff = now - target.getTime();
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000 && target.getDate() === new Date(now).getDate()) {
    return `Today, ${target.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  if (diff >= 0 && diff < 48 * 60 * 60 * 1000) {
    return `Yesterday, ${target.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  return target.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: target.getFullYear() !== new Date(now).getFullYear() ? "numeric" : undefined,
  });
}

export function fullDate(value: string | Date): string {
  return date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dayLabel(value: string | Date, long = false): string {
  return date(value).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    day: "numeric",
  });
}

export function clock(value: string | Date): string {
  return date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function startOfDay(value: string | Date | number): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function filenameStamp(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function shortenPath(value: string, max = 48): string {
  if (value.length <= max) return value;
  const parts = value.split("/");
  if (parts.length < 3) return `…${value.slice(-max + 1)}`;
  return `${parts[0]}/…/${parts.slice(-2).join("/")}`;
}

/** Abbreviates a home directory for display only. Filesystem actions keep the real path. */
export function homePath(value: string): string {
  const match = value.match(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(.*)$/);
  return match ? `~${match[2]}` : value;
}

export function sum<T>(items: T[], getter: (item: T) => number): number {
  return items.reduce((total, item) => total + getter(item), 0);
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 120): T {
  let timer: number | undefined;
  return ((...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  }) as T;
}

export function getInitials(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function isWithinDays(value: string | Date, days: number, now = Date.now()): boolean {
  return now - date(value).getTime() <= days * 86_400_000;
}

export function prettyModel(model: string | null): string {
  if (!model) return "Unknown model";
  const map: Record<string, string> = {
    "claude-opus-4-5": "Claude Opus 4.5",
    "claude-sonnet-4-5": "Claude Sonnet 4.5",
    "claude-haiku-4-5": "Claude Haiku 4.5",
    "claude-4.5-sonnet": "Claude Sonnet 4.5",
    "gpt-5.1-codex": "GPT-5.1 Codex",
    "gpt-5.1-codex-mini": "GPT-5.1 Codex mini",
    "gpt-5.1": "GPT-5.1",
    "composer-1": "Composer 1",
    "kimi-k2": "Kimi K2",
    "qwen3-coder": "Qwen3 Coder",
  };
  return map[model] ?? model.replaceAll("-", " ");
}
