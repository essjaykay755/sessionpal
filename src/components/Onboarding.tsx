import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  FolderLock,
  Gear,
  LockKey,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { AGENT_CLASS, AGENT_ORDER, AGENTS } from "../lib/agents";
import { DEMO_SESSIONS } from "../lib/demo";
import {
  detectAgents,
  fetchProjectFolders,
  fetchSessions,
  isTauri,
  openFolderPrivacySettings,
  platform,
} from "../lib/native";
import { useApp } from "../lib/store";
import type { AgentDetection, AgentId, FolderAccess } from "../lib/types";
import { cn, number } from "../lib/utils";
import { AgentMark, BrandMark } from "./Brand";
import { Button, Switch } from "./ui";

type Step = "welcome" | "detecting" | "agents" | "reading" | "folders" | "finishing";

/**
 * First-launch setup: find the installed agents, let the user choose which
 * to include, and, on macOS, ask for access to protected folders only after
 * explaining why. Nothing is read from project folders before that answer.
 */
export function Onboarding({ onPreviewDone }: { onPreviewDone?: () => void }) {
  const { completeOnboarding, detections: storeDetections, notify } = useApp();
  const preview = !isTauri;
  const [step, setStep] = useState<Step>("welcome");
  const [detections, setDetections] = useState<AgentDetection[]>([]);
  const [selected, setSelected] = useState<AgentId[]>([]);
  const [cwds, setCwds] = useState<string[]>([]);
  const [folders, setFolders] = useState<FolderAccess[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const findAgents = async () => {
    setStep("detecting");
    setProblem(null);
    try {
      const found = preview ? storeDetections : await detectAgents();
      const ordered = AGENT_ORDER.map((id) => found.find((item) => item.id === id)).filter(
        (item): item is AgentDetection => Boolean(item),
      );
      setDetections(ordered);
      setSelected(ordered.filter((item) => item.available).map((item) => item.id));
      setStep("agents");
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
      setStep("welcome");
    }
  };

  const finish = async (allowedFolders: string[]) => {
    setStep("finishing");
    if (preview) {
      notify("Setup preview complete", "The desktop app now runs its first scan.");
      onPreviewDone?.();
      return;
    }
    await completeOnboarding({
      agents: selected,
      access: { inspect: true, allowedFolders },
    });
  };

  const readLibrary = async () => {
    setStep("reading");
    setProblem(null);
    try {
      // A first pass that never opens project folders, just to learn where
      // sessions ran. Parsed transcripts are cached, so the real scan is quick.
      const list = preview
        ? DEMO_SESSIONS.filter((session) => selected.includes(session.agent))
        : await fetchSessions(selected, { inspect: false, allowedFolders: [] });
      const paths = list.map((session) => session.cwd);
      setCwds(paths);
      const protectedFolders = preview
        ? previewFolders(paths.length)
        : platform() === "macos"
          ? await fetchProjectFolders(paths, false)
          : [];
      if (protectedFolders.length === 0) {
        await finish([]);
        return;
      }
      setFolders(protectedFolders);
      setStep("folders");
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
      setStep("agents");
    }
  };

  const requestAccess = async () => {
    setRequesting(true);
    try {
      const result = preview
        ? folders.map(
            (folder, index) =>
              ({
                ...folder,
                status: index === 0 ? "granted" : "denied",
              }) as FolderAccess,
          )
        : await fetchProjectFolders(cwds, true);
      setFolders((current) =>
        current.map((folder) => result.find((item) => item.path === folder.path) ?? folder),
      );
    } finally {
      setRequesting(false);
    }
  };

  const decided = folders.some((folder) => folder.status !== "unknown");
  const granted = folders
    .filter((folder) => folder.status === "granted")
    .map((folder) => folder.path);
  const denied = folders.filter((folder) => folder.status === "denied");
  const totalFound = detections.reduce(
    (sum, item) => sum + (item.available ? item.sessionCount : 0),
    0,
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-y-auto bg-canvas">
      <div data-tauri-drag-region className="h-12 shrink-0" />
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 pb-12">
        <StepDots step={step} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step === "detecting" ? "welcome" : step === "finishing" ? "reading" : step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            {(step === "welcome" || step === "detecting") && (
              <section>
                <BrandMark className="h-11 w-11" />
                <h1 className="mt-5 text-32 font-black leading-[1.05] tracking-[-0.05em] text-fg">
                  Your AI coding sessions, in one calm library.
                </h1>
                <p className="mt-3 text-14 leading-relaxed text-muted">
                  SessionPal finds the conversations your coding agents already keep on this
                  computer, so you can read, search, export and back them up.
                </p>
                <ul className="mt-6 space-y-3">
                  <Pledge icon={<LockKey className="h-4 w-4" />} title="Stays on this computer">
                    No account, no cloud, no telemetry. Nothing is uploaded.
                  </Pledge>
                  <Pledge icon={<ShieldCheck className="h-4 w-4" />} title="Read-only by default">
                    Scanning never changes a file. Deleting or restoring always asks first.
                  </Pledge>
                  <Pledge icon={<Gear className="h-4 w-4" />} title="You choose what's included">
                    Pick the agents next. You can change this later in Settings.
                  </Pledge>
                </ul>
                {problem && <Problem>{problem}</Problem>}
                <div className="mt-8 flex items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={() => void findAgents()}
                    disabled={step === "detecting"}
                    icon={step === "detecting" ? <Spinner /> : undefined}
                  >
                    {step === "detecting" ? "Looking for agents…" : "Find my agents"}
                    {step !== "detecting" && <ArrowRight className="h-3.5 w-3.5" />}
                  </Button>
                  <span className="text-11 text-faint">Takes a moment · read-only</span>
                </div>
              </section>
            )}

            {step === "agents" && (
              <section>
                <Kicker>Step 1 of 2</Kicker>
                <h1 className="mt-2 text-24 font-black tracking-[-0.045em] text-fg">
                  {totalFound > 0
                    ? `Found ${number(totalFound)} sessions on this computer`
                    : "No agent sessions found yet"}
                </h1>
                <p className="mt-2 text-13 leading-relaxed text-muted">
                  Choose which agents SessionPal should include. Agents that are switched off are
                  not read at all.
                </p>
                <ul className="mt-5 space-y-2">
                  {detections.map((item) => {
                    const on = selected.includes(item.id);
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          "flex items-center gap-3 rounded-[14px] border border-line/[0.07] bg-panel px-3.5 py-3",
                          !item.available && "opacity-55",
                        )}
                      >
                        <span
                          className={cn(
                            AGENT_CLASS[item.id],
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--agent-soft)] text-[var(--agent-ink)]",
                          )}
                        >
                          <AgentMark agent={item.id} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-13 font-semibold text-fg">
                            {AGENTS[item.id].name}
                          </span>
                          <span className="block truncate text-11 text-faint" title={item.roots[0]}>
                            {item.available
                              ? `${number(item.sessionCount)} ${item.sessionCount === 1 ? "session" : "sessions"} · ${item.roots[0] ?? ""}`
                              : "Not found on this computer"}
                          </span>
                        </span>
                        <Switch
                          checked={on}
                          disabled={!item.available}
                          label={`Include ${AGENTS[item.id].name}`}
                          onChange={(next) =>
                            setSelected((current) =>
                              next ? [...current, item.id] : current.filter((id) => id !== item.id),
                            )
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
                {problem && <Problem>{problem}</Problem>}
                <div className="mt-6 flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    onClick={() => void findAgents()}
                    icon={<ArrowsClockwise className="h-3.5 w-3.5" />}
                  >
                    Look again
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void readLibrary()}
                    disabled={selected.length === 0}
                  >
                    Continue
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {selected.length === 0 && totalFound > 0 && (
                  <p className="mt-2 text-right text-11 text-faint">Choose at least one agent.</p>
                )}
                {totalFound === 0 && (
                  <p className="mt-3 text-11 leading-relaxed text-faint">
                    Use an agent once and choose “Look again”, or continue and rescan later.
                  </p>
                )}
              </section>
            )}

            {(step === "reading" || step === "finishing") && (
              <section className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-copper-500/10 text-copper-500">
                  <Spinner large />
                </span>
                <h1 className="mt-4 text-20 font-bold tracking-[-0.04em] text-fg">
                  {step === "reading" ? "Reading your sessions…" : "Building your library…"}
                </h1>
                <p className="mt-1.5 text-13 text-muted">
                  Read-only. Nothing leaves this computer.
                </p>
              </section>
            )}

            {step === "folders" && (
              <section>
                <Kicker>Step 2 of 2</Kicker>
                <h1 className="mt-2 text-24 font-black tracking-[-0.045em] text-fg">
                  Group sessions by project
                </h1>
                <p className="mt-2 text-13 leading-relaxed text-muted">
                  Some sessions ran in folders macOS protects. To show real project names and group
                  worktrees with their repository, SessionPal looks for <Code>.git</Code> and{" "}
                  <Code>package.json</Code> there. It never reads your source files.
                </p>
                <ul className="mt-5 space-y-2">
                  {folders.map((folder) => (
                    <li
                      key={folder.path}
                      className="flex items-center gap-3 rounded-[14px] border border-line/[0.07] bg-panel px-3.5 py-3"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-sunken text-muted">
                        <FolderLock className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-13 font-semibold text-fg">{folder.name}</span>
                        <span className="block truncate text-11 text-faint">
                          {folder.path} · {number(folder.sessions)}{" "}
                          {folder.sessions === 1 ? "session" : "sessions"}
                        </span>
                      </span>
                      <FolderStatus status={folder.status} />
                    </li>
                  ))}
                </ul>

                {!decided && (
                  <p className="mt-4 rounded-[12px] bg-sunken/60 px-3.5 py-3 text-12 leading-relaxed text-muted">
                    After you choose <b className="font-semibold text-fg">Allow access</b>, macOS
                    asks once for each folder. Choose <b className="font-semibold text-fg">Allow</b>{" "}
                    in those dialogs.
                  </p>
                )}
                {denied.length > 0 && (
                  <div className="mt-4 rounded-[12px] border border-warning-solid/25 bg-warning-solid/[0.08] px-3.5 py-3 text-12 leading-relaxed text-warning">
                    <p className="font-semibold">
                      {denied.map((folder) => folder.name).join(", ")}{" "}
                      {denied.length === 1 ? "wasn't" : "weren't"} allowed.
                    </p>
                    <p className="mt-1">
                      macOS won't ask again. To allow it, open System Settings → Privacy &amp;
                      Security → Files and Folders → SessionPal, and turn on the folder. Sessions
                      there use their folder name until then.
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void openFolderPrivacySettings().catch(() => undefined)}
                        disabled={preview}
                      >
                        Open System Settings
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void requestAccess()}
                        disabled={requesting}
                      >
                        Check again
                      </Button>
                    </div>
                  </div>
                )}

                <div
                  className={cn(
                    "mt-6 flex items-center gap-3",
                    decided ? "justify-end" : "justify-between",
                  )}
                >
                  {!decided && (
                    <Button variant="ghost" onClick={() => void finish([])}>
                      Skip · use folder names
                    </Button>
                  )}
                  {decided ? (
                    <Button variant="primary" onClick={() => void finish(granted)}>
                      Open my library
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => void requestAccess()}
                      disabled={requesting}
                      icon={requesting ? <Spinner /> : undefined}
                    >
                      {requesting ? "Waiting for macOS…" : "Allow access"}
                    </Button>
                  )}
                </div>
                <p className="mt-3 text-11 text-faint">You can change this any time in Settings.</p>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Sample folders so the browser preview can show the permission step. */
function previewFolders(count: number): FolderAccess[] {
  return [
    {
      name: "Documents",
      path: "~/Documents",
      sessions: Math.round(count * 0.7),
      status: "unknown",
    },
    {
      name: "Desktop",
      path: "~/Desktop",
      sessions: Math.max(1, Math.round(count * 0.05)),
      status: "unknown",
    },
  ];
}

function StepDots({ step }: { step: Step }) {
  const index = useMemo(() => {
    if (step === "welcome" || step === "detecting") return 0;
    if (step === "agents") return 1;
    return 2;
  }, [step]);
  return (
    <div className="mb-8 flex gap-1.5" aria-hidden>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className={cn(
            "h-1 rounded-full transition-all duration-200",
            dot === index ? "w-6 bg-copper-500" : "w-1.5 bg-line/[0.15]",
          )}
        />
      ))}
    </div>
  );
}

function Pledge({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-sunken text-muted">
        {icon}
      </span>
      <span>
        <span className="block text-13 font-semibold text-fg">{title}</span>
        <span className="block text-12 leading-relaxed text-muted">{children}</span>
      </span>
    </li>
  );
}

function FolderStatus({ status }: { status: FolderAccess["status"] }) {
  if (status === "granted") {
    return (
      <span className="flex items-center gap-1 text-11 font-medium text-success">
        <CheckCircle className="h-3.5 w-3.5" weight="fill" /> Allowed
      </span>
    );
  }
  if (status === "denied") {
    return (
      <span className="flex items-center gap-1 text-11 font-medium text-warning">
        <WarningCircle className="h-3.5 w-3.5" weight="fill" /> Not allowed
      </span>
    );
  }
  if (status === "unavailable") return <span className="text-11 text-faint">Not available</span>;
  return <span className="text-11 text-faint">Not asked yet</span>;
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="text-11 font-medium uppercase tracking-[0.14em] text-faint">{children}</div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-sunken px-1 py-px text-12 text-fg/80">{children}</code>;
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-[12px] bg-danger/[0.08] px-3 py-2.5 text-12 text-danger">
      <WarningCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>Couldn't read local agent storage: {children}</span>
    </p>
  );
}

function Spinner({ large }: { large?: boolean }) {
  return (
    <ArrowsClockwise
      className={cn("animate-spin motion-reduce:animate-none", large ? "h-5 w-5" : "h-3.5 w-3.5")}
    />
  );
}

/** Shows setup in the browser preview with `?setup` in the address. */
export function usePreviewOnboarding(): [boolean, () => void] {
  const [open, setOpen] = useState(
    () =>
      !isTauri &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("setup"),
  );
  useEffect(() => {
    if (open || isTauri) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("setup")) {
      url.searchParams.delete("setup");
      window.history.replaceState(null, "", url.toString());
    }
  }, [open]);
  return [open, () => setOpen(false)];
}
