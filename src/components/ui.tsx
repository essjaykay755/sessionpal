import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
} from "motion/react";
import {
  CaretDown,
  Check,
  CircleNotch,
  DotsThree,
  Info,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { AGENTS, AGENT_CLASS } from "../lib/agents";
import type { AgentId } from "../lib/types";
import { cn, number } from "../lib/utils";
import { AgentMark } from "./Brand";

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

type Side = "right" | "left" | "top" | "bottom";

export function Tooltip({
  label,
  side = "right",
  children,
  disabled,
  delay = 320,
}: {
  label: string;
  side?: Side;
  children: ReactNode;
  disabled?: boolean;
  delay?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    if (disabled || open) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setPosition(null);
      setOpen(true);
    }, delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect();
      const bubble = bubbleRef.current?.getBoundingClientRect();
      if (!anchor || !bubble) return;
      const margin = 8;
      const gap = 8;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const centerX = anchor.left + anchor.width / 2;
      const centerY = anchor.top + anchor.height / 2;
      let left = centerX - bubble.width / 2;
      let top = centerY - bubble.height / 2;
      if (side === "right") {
        left = anchor.right + gap;
        if (left + bubble.width > vw - margin && anchor.left - gap - bubble.width >= margin)
          left = anchor.left - gap - bubble.width;
      } else if (side === "left") {
        left = anchor.left - gap - bubble.width;
        if (left < margin && anchor.right + gap + bubble.width <= vw - margin)
          left = anchor.right + gap;
      } else if (side === "bottom") {
        top = anchor.bottom + gap;
        if (top + bubble.height > vh - margin && anchor.top - gap - bubble.height >= margin)
          top = anchor.top - gap - bubble.height;
      } else {
        top = anchor.top - gap - bubble.height;
        if (top < margin && anchor.bottom + gap + bubble.height <= vh - margin)
          top = anchor.bottom + gap;
      }
      setPosition({
        left: Math.max(margin, Math.min(left, vw - bubble.width - margin)),
        top: Math.max(margin, Math.min(top, vh - bubble.height - margin)),
      });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, side, label]);

  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.span
                ref={bubbleRef}
                role="tooltip"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="tooltip-bubble"
                style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "copper" | "secondary" | "ghost" | "soft" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-fg text-canvas hover:bg-fg/90 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset] dark:shadow-none",
  copper:
    "bg-copper-500 text-[#fff8f2] hover:bg-copper-600 shadow-[0_6px_18px_-10px_rgba(157,86,53,0.7)] dark:bg-copper-500 dark:hover:bg-copper-400 dark:text-[#211610]",
  secondary:
    "bg-panel text-fg border border-line/[0.1] hover:bg-sunken/70 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset] dark:shadow-none",
  ghost: "text-muted hover:text-fg hover:bg-line/[0.05]",
  soft: "bg-line/[0.055] text-fg hover:bg-line/[0.09]",
  danger: "bg-danger-solid text-white hover:bg-danger-solid/90",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-13 gap-1.5",
  md: "h-9 px-4 text-13 gap-2",
  lg: "h-11 px-5 text-13 gap-2",
  icon: "h-9 w-9 p-0",
};

export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  loading,
  className,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow,opacity] duration-150 ease-silk disabled:pointer-events-none disabled:opacity-45",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <CircleNotch className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  tooltip = true,
  tooltipSide = "top",
  className,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg" | "icon";
  tooltip?: boolean;
  tooltipSide?: Side;
  active?: boolean;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-full transition-colors duration-200 ease-silk disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-fg text-canvas hover:bg-fg/90"
          : buttonVariants[variant],
        size === "sm" && "h-8 w-8",
        size === "md" && "h-9 w-9",
        size === "lg" && "h-10 w-10",
        size === "icon" && "h-8 w-8",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip label={label} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

type BadgeTone = "neutral" | "copper" | "success" | "warning" | "danger" | "outline";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-line/[0.055] text-muted",
  copper: "bg-copper-100/70 text-copper-700 dark:bg-copper-500/15 dark:text-copper-300",
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  outline: "border border-line/[0.1] text-muted",
};

export function Badge({
  children,
  tone = "neutral",
  dot,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-11 font-medium tracking-[0.01em]",
        badgeTones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export function AgentBadge({
  agent,
  compact = false,
  className,
}: {
  agent: AgentId;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        `${AGENT_CLASS[agent]} inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--agent-soft)] px-2.5 py-1 text-11 font-medium text-[var(--agent-ink)]`,
        className,
      )}
    >
      <AgentMark agent={agent} className="h-3 w-3" />
      {compact ? AGENTS[agent].shortName : AGENTS[agent].name}
    </span>
  );
}

export function EstimatedTag({ className }: { className?: string }) {
  return (
    <Tooltip
      label="Estimated from public API list prices. Not a bill."
      side="top"
    >
      <span
        className={cn(
          "inline-flex cursor-default items-center gap-1 rounded-full border border-line/[0.08] px-2 py-0.5 text-11 font-medium text-faint",
          className,
        )}
      >
        Est.
        <Info className="h-2.5 w-2.5" />
      </span>
    </Tooltip>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-line/[0.1] bg-panel/80 px-1.5 font-sans text-11 font-medium text-muted shadow-[0_1px_0_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[25px] w-[43px] shrink-0 rounded-full p-[3px] transition-colors duration-150 ease-silk focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper-500 disabled:opacity-40",
        checked ? "bg-copper-500" : "bg-line/[0.14]",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        className="block h-[19px] w-[19px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
        style={{ marginLeft: checked ? 18 : 0 }}
      />
    </button>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  shortcut = "⌘ K",
  onShortcut,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  shortcut?: string;
  onShortcut?: () => void;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div
      className={cn(
        "group flex h-11 items-center gap-2.5 rounded-full border border-line/[0.09] bg-panel px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition-all duration-150 ease-silk focus-within:border-copper-500/40 focus-within:shadow-[0_0_0_3px_rgba(184,105,63,0.09)] dark:shadow-none",
        className,
      )}
    >
      <MagnifyingGlass className="h-4 w-4 shrink-0 text-faint" />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-13 text-fg outline-none placeholder:text-faint/90"
      />
      {onShortcut ? (
        <button
          type="button"
          onClick={onShortcut}
          className="flex items-center gap-0.5 rounded-md px-1 py-0.5 text-faint transition-colors hover:text-fg"
          aria-label="Open command palette"
        >
          <Kbd className="pointer-events-none">{shortcut}</Kbd>
        </button>
      ) : (
        shortcut && <Kbd className="pointer-events-none">{shortcut}</Kbd>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  compact = false,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; ariaLabel?: string }>;
  onChange: (value: T) => void;
  className?: string;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full bg-line/[0.055] p-[3px]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            aria-label={option.ariaLabel}
            className={cn(
              "relative rounded-full font-medium transition-colors duration-200",
              compact ? "h-6 px-2.5 text-11" : "h-7 px-3 text-12",
              active ? "text-fg" : "text-faint hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segment-${id}`}
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
                className="absolute inset-0 rounded-full bg-raised shadow-[0_1px_3px_rgba(25,18,10,0.1)] dark:bg-white/[0.1]"
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1.5">
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  kicker,
  icon,
  children,
  footer,
  width = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  kicker?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  dismissible?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
    };
    document.addEventListener("keydown", onKey);
    const timeout = window.setTimeout(() => panelRef.current?.focus(), 40);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timeout);
    };
  }, [open, dismissible, onClose]);

  if (typeof document === "undefined") return null;

  const widths = {
    sm: "max-w-[420px]",
    md: "max-w-[520px]",
    lg: "max-w-[640px]",
    xl: "max-w-[780px]",
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-[#14110d]/45 backdrop-blur-[4px] dark:bg-black/60"
            onClick={() => dismissible && onClose()}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "relative z-10 flex max-h-[min(90dvh,860px)] w-full flex-col overflow-hidden rounded-[28px] border border-white/10 bg-panel shadow-float outline-none dark:border-white/[0.07]",
              widths[width],
            )}
          >
            <header className="flex items-start gap-3.5 px-6 pb-4 pt-6 sm:px-7 sm:pt-7">
              {icon && (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-line/[0.055] text-muted">
                  {icon}
                </div>
              )}
              <div className="min-w-0 flex-1">
                {kicker && (
                  <div className="mb-1 text-11 font-medium uppercase tracking-[0.14em] text-faint">
                    {kicker}
                  </div>
                )}
                <h2
                  id={titleId}
                  className="text-18 font-bold leading-[1.2] tracking-[-0.03em] text-fg"
                >
                  {title}
                </h2>
                {description && (
                  <p className="mt-1.5 text-13 leading-relaxed text-muted">{description}</p>
                )}
              </div>
              {dismissible && (
                <button
                  type="button"
                  onClick={onClose}
                  className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-line/[0.06] hover:text-fg"
                  aria-label="Close dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-7">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-2 border-t border-line/[0.07] bg-sunken/35 px-6 py-4 sm:px-7">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Menus                                                               */
/* ------------------------------------------------------------------ */

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

function MenuPopover({
  open,
  anchor,
  items,
  onClose,
  width = 196,
  align = "end",
}: {
  open: boolean;
  anchor: DOMRect | null;
  items: MenuItem[];
  onClose: () => void;
  width?: number;
  align?: "start" | "end";
}) {
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-menu-popover]") && !target.closest("[data-menu-trigger]")) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const closeOnScroll = () => onClose();
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", closeOnScroll);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", closeOnScroll);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open, onClose]);

  if (typeof document === "undefined" || !anchor) return null;

  const estimatedHeight = items.length * 38 + 12;
  const roomBelow = window.innerHeight - anchor.bottom;
  const placeAbove = roomBelow < estimatedHeight + 16;
  const left =
    align === "end"
      ? Math.min(window.innerWidth - width - 10, Math.max(10, anchor.right - width))
      : Math.min(window.innerWidth - width - 10, Math.max(10, anchor.left));
  const top = placeAbove
    ? Math.max(10, anchor.top - estimatedHeight - 6)
    : Math.min(window.innerHeight - estimatedHeight - 10, anchor.bottom + 6);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          data-menu-popover
          initial={{ opacity: 0, scale: 0.97, y: placeAbove ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: placeAbove ? 3 : -3 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "fixed",
            left,
            top,
            width,
            transformOrigin: placeAbove ? "bottom" : "top",
          }}
          className="z-[100] overflow-hidden rounded-[15px] border border-line/[0.1] bg-panel p-1.5 shadow-float"
          role="menu"
        >
          {items.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-12 font-medium transition-colors disabled:opacity-40",
                item.danger
                  ? "text-danger hover:bg-danger/[0.08]"
                  : "text-fg/85 hover:bg-line/[0.055] hover:text-fg",
              )}
            >
              {item.icon && <span className="shrink-0 opacity-70">{item.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="text-11 text-faint">{item.hint}</span>}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function KebabMenu({
  items,
  label = "More actions",
  className,
}: {
  items: MenuItem[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        data-menu-trigger
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(ref.current?.getBoundingClientRect() ?? null);
          setOpen((current) => !current);
        }}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-line/[0.06] hover:text-fg",
          open && "bg-line/[0.06] text-fg",
          className,
        )}
      >
        <DotsThree className="h-5 w-5" weight="bold" />
      </button>
      <MenuPopover open={open} anchor={anchor} items={items} onClose={() => setOpen(false)} />
    </>
  );
}

export function SelectMenu({
  label,
  value,
  options,
  onChange,
  icon,
  className,
  align = "start",
  width = 196,
}: {
  label?: string;
  value: string;
  options: Array<{ value: string; label: string; sublabel?: string }>;
  onChange: (value: string) => void;
  icon?: ReactNode;
  className?: string;
  align?: "start" | "end";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find((option) => option.value === value);
  return (
    <>
      <button
        ref={ref}
        data-menu-trigger
        type="button"
        aria-haspopup="listbox"
        aria-label={label}
        onClick={() => {
          setAnchor(ref.current?.getBoundingClientRect() ?? null);
          setOpen((state) => !state);
        }}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-full border border-line/[0.09] bg-panel px-3.5 text-12 font-medium text-fg transition-colors hover:bg-sunken/60",
          className,
        )}
      >
        {icon && <span className="text-faint">{icon}</span>}
        <span>{current?.label ?? value}</span>
        <CaretDown className="h-3 w-3 text-faint" />
      </button>
      <MenuPopover
        open={open}
        anchor={anchor}
        width={width}
        align={align}
        onClose={() => setOpen(false)}
        items={options.map((option) => ({
          label: option.sublabel ? `${option.label} · ${option.sublabel}` : option.label,
          icon:
            option.value === value ? (
              <Check className="h-3.5 w-3.5 text-copper-500" />
            ) : (
              <span className="block h-3.5 w-3.5" />
            ),
          onSelect: () => onChange(option.value),
        }))}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Animated number                                                     */
/* ------------------------------------------------------------------ */

export function AnimatedNumber({
  value,
  format = number,
  className,
  spring = true,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
  spring?: boolean;
}) {
  return <span className={cn("tabular", className)}>{format(value)}</span>;
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center",
        className,
      )}
    >
      <div className="relative mb-4">
        <span className="absolute inset-0 -m-3 rounded-full border border-dashed border-line/[0.12]" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-[17px] bg-line/[0.045] text-muted">
          {icon}
        </div>
      </div>
      <h3 className="text-14 font-semibold tracking-[-0.02em] text-fg">{title}</h3>
      <p className="mt-1.5 max-w-[300px] text-12 leading-relaxed text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[12px] bg-line/[0.06]",
        className,
      )}
    />
  );
}

export function InfoNote({
  children,
  icon,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[16px] border border-line/[0.07] bg-line/[0.025] px-3.5 py-3 text-12 leading-relaxed text-muted",
        className,
      )}
    >
      <span className="mt-0.5 shrink-0 text-faint">
        {icon ?? <Info className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
