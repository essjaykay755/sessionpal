import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle,
  Info,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useApp } from "../lib/store";
import { cn } from "../lib/utils";

export function Toasts() {
  const { toasts, dismissToast } = useApp();

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[120] flex max-w-[min(300px,calc(100vw-32px))] flex-col items-end gap-1.5"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const icon =
            toast.tone === "success" ? (
              <CheckCircle className="h-4 w-4" weight="fill" />
            ) : toast.tone === "danger" ? (
              <WarningCircle className="h-4 w-4" weight="fill" />
            ) : (
              <Info className="h-4 w-4" weight="fill" />
            );
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className={cn(
                "pointer-events-auto relative w-fit max-w-full rounded-[10px] border border-line/[0.12] bg-raised px-3 py-2.5 pr-9 shadow-[0_6px_20px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)]",
                "dark:border-white/[0.1] dark:shadow-[0_6px_20px_rgba(0,0,0,0.3)]",
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    toast.tone === "success"
                      ? "text-success"
                      : toast.tone === "danger"
                        ? "text-danger"
                        : "text-copper-500 dark:text-copper-300",
                  )}
                >
                  {icon}
                </span>
                <div className="min-w-0">
                  <div className="text-12 font-semibold leading-[1.35] text-fg">
                    {toast.title}
                  </div>
                  {toast.description && (
                    <div className="mt-0.5 text-12 leading-[1.4] text-muted">
                      {toast.description}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-line/[0.06] hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
