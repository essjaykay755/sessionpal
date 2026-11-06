import { Minus, Square, X } from "@phosphor-icons/react";
import { useApp } from "../lib/store";

/** Windows-style caption buttons for the undecorated desktop window. */
export function WindowsWindowControls() {
  const { windowAction, notify } = useApp();
  const run = (action: "minimize" | "maximize" | "close") => {
    void windowAction(action).catch((error) => {
      notify("Window action failed", String(error));
    });
  };
  const base = "flex h-full w-[46px] shrink-0 items-center justify-center text-fg/75 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-copper-500";
  return (
    <div className="flex shrink-0 self-stretch" role="group" aria-label="Window controls">
      <button type="button" className={`${base} hover:bg-line/[0.08]`} aria-label="Minimize window" title="Minimize" onClick={() => run("minimize")}><Minus size={14} /></button>
      <button type="button" className={`${base} hover:bg-line/[0.08]`} aria-label="Maximize or restore window" title="Maximize or restore" onClick={() => run("maximize")}><Square size={12} /></button>
      <button type="button" className={`${base} hover:bg-[#c42b1c] hover:text-white`} aria-label="Close window" title="Close" onClick={() => run("close")}><X size={14} /></button>
    </div>
  );
}
