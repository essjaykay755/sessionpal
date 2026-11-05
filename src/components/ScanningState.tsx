import { motion } from "motion/react";
import { ArrowsClockwise, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { AGENTS, AGENT_CLASS, AGENT_ORDER } from "../lib/agents";
import { cn } from "../lib/utils";
import { AgentMark, BrandMark } from "./Brand";
import { PageHeader, PageScroll } from "./PageChrome";
import { Button } from "./ui";

/**
 * Shown only while the desktop app performs its first read-only scan: the
 * Overview's layout with placeholders, so the real numbers land in place.
 * Sample data is deliberately never displayed in the native build, so the
 * user is never shown fake sessions as if they were their own.
 */
export function ScanningState() {
  return (
    <PageScroll>
      <div role="status" aria-live="polite" aria-busy="true">
        <PageHeader
          title="Overview"
          subtitle="Reading your library…"
          actions={
            <span className="flex items-center gap-2 rounded-full border border-line/[0.08] px-3 py-1.5 text-11 text-muted">
              <ArrowsClockwise className="h-3.5 w-3.5 animate-spin text-copper-500 motion-reduce:animate-none" />
              Read-only scan · nothing leaves this device
            </span>
          }
        />

        <section className="card flex flex-col overflow-hidden lg:flex-row">
          <div className="min-w-0 flex-1 p-5 sm:p-6">
            <Bone className="h-3.5 w-40" />
            <Bone className="mt-3 h-10 w-36" />
            <Bone className="mt-4 h-5 w-56 rounded-full" />
            <Bone className="mt-6 h-[120px] w-full rounded-[14px]" />
          </div>
          <div className="grid grid-cols-2 border-t border-line/[0.06] bg-sunken/30 sm:grid-cols-4 lg:w-[232px] lg:grid-cols-1 lg:border-l lg:border-t-0">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="px-5 py-4">
                <Bone className="h-3 w-20" />
                <Bone className="mt-2 h-4 w-16" />
                <Bone className="mt-1.5 h-3 w-24" />
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="card p-5 sm:px-6 lg:col-span-8">
            <div className="text-16 font-bold tracking-[-0.035em] text-fg/40">Recent sessions</div>
            <div className="mt-4 space-y-3.5">
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="flex items-center gap-3">
                  <Bone className="h-9 w-9 shrink-0 rounded-[11px]" />
                  <div className="min-w-0 flex-1">
                    <Bone className="h-3.5" style={{ width: `${62 - index * 7}%` }} />
                    <Bone className="mt-1.5 h-3 w-1/3" />
                  </div>
                  <Bone className="hidden h-5 w-16 rounded-full sm:block" />
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 lg:col-span-4">
            <div className="text-14 font-bold tracking-[-0.025em] text-fg/40">Agents</div>
            <Bone className="mt-3.5 h-2 w-full rounded-full" />
            <ul className="mt-3 space-y-1">
              {AGENT_ORDER.map((id) => (
                <li key={id} className={`${AGENT_CLASS[id]} flex items-center gap-2.5 py-2`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--agent-soft)] text-[var(--agent-ink)] opacity-70">
                    <AgentMark agent={id} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-12 font-semibold text-fg/55">{AGENTS[id].name}</span>
                    <span className="block text-11 text-faint">Looking…</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </PageScroll>
  );
}

function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={cn("skeleton block rounded-[6px]", className)} style={style} />;
}

/**
 * Shown when the desktop app's first scan fails. There is deliberately no
 * sample-data fallback here: the library stays empty until a scan succeeds.
 */
export function ScanFailedState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-5 py-10 sm:px-8">
      <div className="w-full max-w-[470px] text-center" role="alert">
        <span className="mx-auto flex h-[64px] w-[64px] items-center justify-center rounded-[20px] bg-danger/10 text-danger">
          <WarningCircle className="h-8 w-8" />
        </span>
        <h1 className="mt-7 text-32 font-black leading-[1.05] tracking-[-0.05em] text-fg">
          Couldn't read your library
        </h1>
        <p className="mx-auto mt-2.5 max-w-[380px] text-13 leading-relaxed text-muted">
          SessionPal couldn't scan local agent storage on this device. Nothing was changed on disk.
        </p>
        {error && (
          <pre className="mx-auto mt-4 max-h-[140px] max-w-[420px] overflow-auto whitespace-pre-wrap break-words rounded-[12px] border border-line/[0.08] bg-sunken/50 px-3 py-2 text-left font-mono text-12 text-muted">
            {error}
          </pre>
        )}
        <div className="mt-6 flex justify-center">
          <Button variant="copper" size="sm" icon={<ArrowsClockwise className="h-3.5 w-3.5" />} onClick={onRetry}>
            Try again
          </Button>
        </div>
        <div className="mt-4 flex items-center justify-center gap-1.5 text-12 text-faint">
          <ShieldCheck className="h-3.5 w-3.5" />
          Nothing is uploaded. Files never leave this machine.
        </div>
      </div>
    </div>
  );
}
