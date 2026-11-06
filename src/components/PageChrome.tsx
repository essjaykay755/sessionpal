import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export function PageScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("h-full overflow-y-auto", className)}>
      <div className="mx-auto w-full max-w-[1380px] px-4 pb-8 pt-1 sm:px-5 xl:px-6">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  bottom,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  actions?: ReactNode;
  className?: string;
  bottom?: ReactNode;
}) {
  return (
    <div className={cn("mb-4", className)}>
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="text-28 font-bold leading-tight tracking-[-0.03em] text-fg">{title}</h1>
          <p className="mt-1 line-clamp-2 max-w-[68ch] text-13 leading-snug text-muted">{subtitle}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {bottom && <div className="mt-4">{bottom}</div>}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
  className,
  subtitle,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  subtitle?: ReactNode;
}) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div>
        <h2 className="text-14 font-bold tracking-[-0.035em] text-fg">{children}</h2>
      </div>
      {action}
    </div>
  );
}

/** In-page navigation that keeps the main sidebar focused on top-level areas. */
export function SectionNav<T extends string>({
  label,
  value,
  options,
  onChange,
  idPrefix,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  idPrefix: string;
}) {
  return (
    <nav aria-label={label} className="mb-5 flex flex-wrap gap-1 border-b border-line/[0.08]">
      {options.map((option) => (
        <button
          key={option.value}
          id={`${idPrefix}-${option.value}`}
          type="button"
          aria-current={value === option.value ? "page" : undefined}
          onClick={() => onChange(option.value)}
          className={cn(
            "-mb-px border-b-2 px-3 py-2.5 text-12 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500",
            value === option.value
              ? "border-copper-500 text-fg"
              : "border-transparent text-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
}
