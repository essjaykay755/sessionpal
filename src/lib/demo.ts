import { AGENT_ORDER, AGENTS, PROJECTS, projectFromSlug } from "./agents";
import { estimateUsage, modelsForAgent, usageTokens } from "./pricing";
import { searchMessages } from "./search";
import type {
  ActivityEvent,
  AgentId,
  BackupRecord,
  ContentHit,
  DayUsage,
  Message,
  SessionDetail,
  SessionSummary,
  UsageBreakdown,
} from "./types";

/**
 * Deterministic, realistic sample data for the browser preview.
 * Every value is computed locally. Nothing here is uploaded anywhere.
 */

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MB = 1024 * 1024;

function ago(parts: { days?: number; hours?: number; minutes?: number }): string {
  const ms =
    (parts.days ?? 0) * 86_400_000 +
    (parts.hours ?? 0) * HOUR +
    (parts.minutes ?? 0) * MINUTE;
  return new Date(NOW - ms).toISOString();
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

function round(value: number): number {
  return Math.round(value);
}

function makeUsage(
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite = 0,
): UsageBreakdown {
  return estimateUsage(model, { input, output, cacheRead, cacheWrite });
}

type MessageSeed = Omit<Message, "id" | "timestamp"> & { timestamp?: string };

interface RawSession {
  id: string;
  agent: AgentId;
  title: string;
  excerpt: string;
  project: string;
  updatedAt: string;
  ageMinutes: number;
  durationMinutes: number;
  model: string;
  usage: UsageBreakdown | null;
  sizeBytes: number;
  branch: string | null;
  messages: MessageSeed[];
}

function distribute(session: RawSession): SessionDetail {
  const start = new Date(NOW - session.ageMinutes * MINUTE).getTime();
  const end = start + session.durationMinutes * MINUTE;
  const summary = featuredSummary(session);
  const messages = session.messages.map((message, index) => {
    const ratio = session.messages.length > 1 ? index / (session.messages.length - 1) : 0;
    return {
      ...message,
      id: `${session.id}_m${index}`,
      timestamp: message.timestamp ?? new Date(start + (end - start) * ratio).toISOString(),
    } satisfies Message;
  });
  return {
    ...summary,
    messages,
    messageCount: messages.length,
    durationMs: Math.max(1, end - start),
  };
}

function featuredSummary(session: RawSession): SessionSummary {
  const project = projectFromSlug(session.project);
  const created = new Date(
    new Date(NOW - session.ageMinutes * MINUTE).getTime(),
  ).toISOString();
  return {
    id: session.id,
    agent: session.agent,
    title: session.title,
    excerpt: session.excerpt,
    project: project.slug,
    projectLabel: project.label,
    cwd: `~/Projects/${project.slug}`,
    branch: session.branch,
    createdAt: created,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    tokens: usageTokens(session.usage),
    sizeBytes: session.sizeBytes,
    model: session.model,
    models: [session.model],
    usage: session.usage,
    format:
      session.agent === "cursor" || session.agent === "antigravity"
        ? "sqlite"
        : session.agent === "opencode"
          ? "json"
          : "jsonl",
    path: demoPath(session.agent, project.slug, session.id),
    deletable: true,
    demo: true,
    tint: project.tint,
    icon: project.icon,
  };
}

function demoPath(agent: AgentId, slug: string, id: string): string {
  switch (agent) {
    case "claude":
      return `~/.claude/projects/-Users-you-Projects-${slug}/${id}.jsonl`;
    case "codex":
      return `~/.codex/sessions/2026/11/05/rollout-${id}.jsonl`;
    case "cursor":
      return "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb";
    case "opencode":
      return `~/.local/share/opencode/storage/session/${slug}/${id}.json`;
    case "antigravity":
      return "~/.gemini/antigravity/conversation_summaries.db";
  }
}

/* ------------------------------------------------------------------ */
/* Featured conversations                                              */
/* ------------------------------------------------------------------ */

const FEATURED_RAW: RawSession[] = [
  {
    id: "ses_roadster_thruster",
    agent: "claude",
    title: "Roadster thruster prototype",
    excerpt: "Implement thrust vectoring and a control-loop simulation.",
    project: "roadster-lab",
    updatedAt: ago({ hours: 2, minutes: 6 }),
    ageMinutes: 2 * 60 + 6,
    durationMinutes: 96,
    model: "claude-opus-4-5",
    usage: makeUsage("claude-opus-4-5", 48_000, 18_400, 60_000, 8_000),
    sizeBytes: 38.4 * MB,
    branch: "feat/thruster-control",
    messages: [
      {
        role: "user",
        content:
          "Build me a small control-loop sim for the roadster thruster prototype. I want two-axis thrust vectoring, a gimbal model, and something I can run from the terminal.",
      },
      {
        role: "assistant",
        content:
          "I'll wire this into the existing sim rather than adding a parallel harness. Here's the shape:\n\n- Add a `Gimbal` model with pitch/yaw limits and slew rate.\n- Add a PID controller with explicit anti-windup.\n- Expose a `step(throttle, targetVector)` entry point from `engine.ts`.\n- Cover the controller with a throttle sweep test.\n\nReading the engine first so the new loop matches the current tick rate.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "src/sim/engine.ts",
        content: "Read 214 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "The engine ticks at 120 Hz and already exposes a fixed-step accumulator, so the controller can stay deterministic. I'm adding the gimbal as a pure model and keeping the loop separate from rendering.\n\n```ts\nexport class ThrusterController {\n  private integral = { pitch: 0, yaw: 0 };\n\n  step(dt: number, throttle: number, target: Vector2) {\n    const error = this.aim.subtract(this.currentAngle(target));\n    this.integral.pitch += error.pitch * this.ki * dt;\n    this.integral.yaw += error.yaw * this.ki * dt;\n\n    return this.gimbal.command({\n      pitch: this.pid(error.pitch, this.integral.pitch),\n      yaw: this.pid(error.yaw, this.integral.yaw),\n      throttle: clamp(throttle, 0, 1),\n    });\n  }\n}\n```\n\nNext I'll add the slew limiter and a readable trace for tuning.",
      },
      {
        role: "user",
        content:
          "The gimbal overshoots badly below 20% throttle. It looks like integral windup, but I'd like the trace before we change anything.",
      },
      {
        role: "assistant",
        content:
          "Confirmed. The integrator keeps accumulating while the actuator is saturated, and the slew limiter is applied *after* the clamp so it never actually limits the command. Two small fixes:\n\n1. Freeze integration when the gimbal is at its limit.\n2. Apply slew limiting before the final clamp.\n\nI also added a back-calculation term so the integrator unwinds smoothly when the target reverses.",
      },
      {
        role: "tool",
        toolName: "Edit",
        toolDetail: "src/sim/thruster.ts",
        content: "Updated control loop and slew limiter",
        toolStatus: "ok",
      },
      {
        role: "tool",
        toolName: "Bash",
        toolDetail: "pnpm vitest run thruster --reporter=verbose",
        content: "9 passing · 1.4s",
        toolStatus: "ok",
      },
      {
        role: "user",
        content:
          "Good. Add a simulation that sweeps throttle from 10% to 100% and snapshots the resulting vector at each step.",
      },
      {
        role: "assistant",
        content:
          "Added `thruster.sweep.test.ts`. At each 5% step it lets the controller settle for 240 ticks, then records pitch, yaw, and residual error. Low-throttle overshoot is gone, and the worst steady-state error is 0.12°.\n\n```ts\nfor (let throttle = 0.1; throttle <= 1; throttle += 0.05) {\n  const frame = sim.settle({ throttle, ticks: 240 });\n  snapshots.push(frame.vector);\n  expect(frame.error).toBeLessThan(0.25);\n}\n```\n\nAll nine tests pass. The trace is written to `tmp/thruster-sweep.json` for plotting.",
      },
      {
        role: "assistant",
        content:
          "Done. The thruster now has a deterministic controller, conditional anti-windup, and a throttle sweep harness. The sim is ready for you to tune gains against the real actuator profile.",
      },
    ],
  },
  {
    id: "ses_prepapp_onboarding",
    agent: "codex",
    title: "PrepApp onboarding UI",
    excerpt: "First-run flow and project setup screens.",
    project: "prepapp",
    updatedAt: ago({ hours: 4, minutes: 12 }),
    ageMinutes: 4 * 60 + 12,
    durationMinutes: 74,
    model: "gpt-5.1-codex",
    usage: makeUsage("gpt-5.1-codex", 21_000, 9_900, 24_000, 2_000),
    sizeBytes: 21.7 * MB,
    branch: "feat/onboarding-flow",
    messages: [
      {
        role: "user",
        content:
          "We need a first-run flow for PrepApp. Three steps: pick a role, set a weekly goal, and create the first practice set. Keep it skippable, and make the empty dashboard feel useful.",
      },
      {
        role: "assistant",
        content:
          "I found the current onboarding stub and the dashboard shell. I'll build a three-step modal route with a quiet progress rail, persist partial answers locally, and make skip land on a dashboard with a single clear next action.\n\nReading the routing and design tokens first.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "src/app/(dashboard)/page.tsx",
        content: "Read 96 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "The route structure supports a parallel modal. I'm keeping each step as a small component and moving state into a reducer so back/forward never loses an answer.\n\n```tsx\nconst [state, dispatch] = useReducer(onboardingReducer, {\n  step: 0,\n  role: null,\n  weeklyGoal: 3,\n  skipped: false,\n});\n```\n\nThe dashboard will show the goal and one suggested practice set when onboarding is complete.",
      },
      {
        role: "user",
        content:
          "The progress rail jumps on mobile when step labels wrap. Can you make the transition feel quieter? It's the first screen people see.",
      },
      {
        role: "assistant",
        content:
          "Fixed by reserving a single line for the label and animating the rail with transforms only. I also tightened the step copy so nothing needs to wrap at 320px.\n\nOn narrow screens the labels collapse to numbers with an accessible description; the rail keeps the same geometry between steps, so there is no jump.",
      },
      {
        role: "tool",
        toolName: "Bash",
        toolDetail: "pnpm test onboarding",
        content: "6 passing · 940ms",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "Onboarding is in place, including the skippable path and a dashboard state for both outcomes. I kept the new empty dashboard local, so we can review the copy before wiring analytics — which, to be clear, we won't add by default.",
      },
    ],
  },
  {
    id: "ses_cache_migration",
    agent: "claude",
    title: "Cache migration plan",
    excerpt: "Map the Redis-to-SQLite migration without downtime.",
    project: "api-core",
    updatedAt: ago({ days: 1, hours: 4, minutes: 2 }),
    ageMinutes: 28 * 60 + 2,
    durationMinutes: 64,
    model: "claude-sonnet-4-5",
    usage: makeUsage("claude-sonnet-4-5", 36_800, 13_300, 48_000, 3_000),
    sizeBytes: 18.9 * MB,
    branch: "plan/cache-migration",
    messages: [
      {
        role: "user",
        content:
          "We're moving the response cache from Redis to SQLite on each edge node. I need a migration plan that won't drop cached tool results mid-flight. No downtime is acceptable for reads.",
      },
      {
        role: "assistant",
        content:
          "I read the cache adapter and the edge bootstrap. The key constraint is that SQLite cannot be shared across nodes, so this becomes a per-node warm cache rather than a distributed one. That's fine for tool results, but we need a clear fallback path when a node misses.\n\nI'd proceed in three phases:\n\n1. Add a local SQLite cache behind the existing interface, disabled by default.\n2. Dual-write from Redis to local during a shadow window; track hit ratio and write pressure.\n3. Flip reads per node, keeping Redis as a read-through fallback for one release.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "packages/cache/src/adapter.ts",
        content: "Read 168 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "The adapter already has a narrow `get`/`set`/`delete` surface, so we can add the SQLite implementation without touching call sites. I'd avoid using WAL mode for the first cut; with thousands of small tool-result writes, checkpoint stalls were the source of the last incident.\n\nOne important detail: cache entries need a schema version in the key. Old tool results can be replayed with incompatible shapes otherwise.",
      },
      {
        role: "user",
        content:
          "What does rollback look like if the local cache causes read amplification on the busiest node?",
      },
      {
        role: "assistant",
        content:
          "A per-node feature flag, evaluated at boot and at the start of each request batch. Rollback is immediate: stop reading local, keep dual-writes briefly, then drain the SQLite file. No data migration is required because this cache is disposable by design.\n\nI'd also cap the local store at 2 GB and use a simple LRU eviction job. It's a cache, not a source of truth.",
      },
      {
        role: "assistant",
        content:
          "Migration plan written to `docs/cache-migration.md` with the feature flags, shadow metrics, rollback steps, and a 30-minute runbook. The risky part is not the storage engine; it's forgetting the schema version in the key.",
      },
    ],
  },
  {
    id: "ses_maglev_storyboard",
    agent: "cursor",
    title: "Maglev animation storyboard",
    excerpt: "Draft scene timing and scroll choreography.",
    project: "maglev-demo",
    updatedAt: ago({ days: 1, hours: 9, minutes: 43 }),
    ageMinutes: 33 * 60 + 43,
    durationMinutes: 88,
    model: "composer-1",
    usage: makeUsage("composer-1", 30_000, 12_600, 30_000, 2_500),
    sizeBytes: 64.2 * MB,
    branch: "feat/maglev-story",
    messages: [
      {
        role: "user",
        content:
          "I want the Maglev demo to feel calm instead of impressive. A scroll story with three scenes: arrival, levitation, departure. Draft the timings and show me the section structure.",
      },
      {
        role: "assistant",
        content:
          "Reading the existing demo first. For a calmer feel, I'd remove the pinned intro and let the first scene breathe at natural scroll speed. The levitation moment gets one pin, and the departure becomes a quiet dissolve rather than a horizontal wipe.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "src/scenes/Maglev.tsx",
        content: "Read 312 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "Here's the timing map I'd start with:\n\n- Arrival: 0–28% scroll, 16px/s drift, no parallax.\n- Levitation: pin for 140vh, one eased uptick, magnetic field lines draw once.\n- Departure: unpin at 72%, vignette and copy fade together.\n\n```ts\nconst lift = useTransform(scrollYProgress, [0.33, 0.62], [0, -96]);\nconst veil = useTransform(scrollYProgress, [0.68, 0.86], [0.18, 1]);\n```\n\nThe key is that two things never animate at once. The eye should have one event per beat.",
      },
      {
        role: "tool",
        toolName: "Edit",
        toolDetail: "src/scenes/Maglev.tsx",
        content: "Added arrival and departure scenes",
        toolStatus: "ok",
      },
      {
        role: "user",
        content:
          "The pin feels heavy on the trackpad. Can we shorten it without losing the levitation moment?",
      },
      {
        role: "assistant",
        content:
          "Shortened the pin from 140vh to 96vh and moved the field-line draw into the first third. The moment still reads, but the page releases sooner. I also added a `prefers-reduced-motion` path that renders the three scenes as a static editorial sequence.",
      },
      {
        role: "assistant",
        content:
          "Storyboard updated. The next step is sound design, but I'd wait until the motion is locked; audio makes broken timing harder to judge.",
      },
    ],
  },
  {
    id: "ses_native_window",
    agent: "opencode",
    title: "Refine native window layout",
    excerpt: "Tune titlebar, traffic lights and split view.",
    project: "sessionpal",
    updatedAt: ago({ days: 2, hours: 3, minutes: 4 }),
    ageMinutes: 51 * 60 + 4,
    durationMinutes: 52,
    model: "kimi-k2",
    usage: makeUsage("kimi-k2", 14_000, 5_800, 14_000, 1_500),
    sizeBytes: 9.6 * MB,
    branch: "fix/native-titlebar",
    messages: [
      {
        role: "user",
        content:
          "The custom titlebar is too tall on Windows and the traffic lights overlap the sidebar on macOS. I want it to feel native on both without giving up the dark rail.",
      },
      {
        role: "assistant",
        content:
          "I'll measure the titlebar against both platform defaults. On macOS the rail needs a small top inset for the native traffic lights; on Windows the window controls should live at the far right of the content header, not inside the rail.\n\nReading the Tauri window config and the shell layout first.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "src-tauri/tauri.conf.json",
        content: "Read 48 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "The window is using `decorations: false` on both platforms, so SessionPal owns the whole titlebar. I'll add a platform-aware header: 28px on macOS with a drag region that avoids the controls, 36px on Windows with right-aligned hover targets.\n\n```tsx\nconst inset = platform === \"macos\" ? \"pl-[72px]\" : \"pr-[132px]\";\n```\n\nThe rail stays fixed; only the first 32 pixels change.",
      },
      {
        role: "user",
        content:
          "Make sure dragging the window still works from the empty header area and double-click maximizes on Windows.",
      },
      {
        role: "assistant",
        content:
          "Added `data-tauri-drag-region` to the header background and the wordmark, leaving every button and tab outside it. On Windows, the native double-click maximize is handled by the window manager; my custom controls call `toggleMaximize()` explicitly for consistency.",
      },
      {
        role: "assistant",
        content:
          "Layout is adjusted for both platforms. The rail now has a 36px top inset on macOS, and the Windows controls sit on a 36px optical center with a 44px hit target.",
      },
    ],
  },
  {
    id: "ses_billing_webhook",
    agent: "claude",
    title: "Billing webhook retry queue",
    excerpt: "Idempotent retries for failed payment events.",
    project: "atlas-api",
    updatedAt: ago({ hours: 6, minutes: 24 }),
    ageMinutes: 6 * 60 + 24,
    durationMinutes: 118,
    model: "claude-sonnet-4-5",
    usage: makeUsage("claude-sonnet-4-5", 70_000, 24_400, 88_000, 12_000),
    sizeBytes: 42.8 * MB,
    branch: "feat/webhook-retries",
    messages: [
      {
        role: "user",
        content:
          "Failed Stripe webhooks currently disappear into a log line. I need a durable retry queue with exponential backoff and idempotency, without adding Redis or another service.",
      },
      {
        role: "assistant",
        content:
          "The repo already has Postgres and a worker loop, so I'd use a `webhook_deliveries` table with a unique event ID, attempt count, and `next_attempt_at`. Claim rows with `FOR UPDATE SKIP LOCKED`, run handlers in the existing worker, and mark success terminally. No new infrastructure.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "src/billing/webhooks.ts",
        content: "Read 286 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "One catch: the handler currently mutates invoices before validating the event type. The idempotency key only helps if the handler is wrapped in a transaction. I'm proposing a small `handleOnce(event)` helper that inserts the delivery row and performs the mutation in the same transaction, so a crash cannot double-apply a payment.",
      },
      {
        role: "tool",
        toolName: "Write",
        toolDetail: "src/billing/webhook-queue.ts",
        content: "Created retry queue (142 lines)",
        toolStatus: "ok",
      },
      {
        role: "user",
        content:
          "What happens when two workers pick up the same event at the same time?",
      },
      {
        role: "assistant",
        content:
          "`SKIP LOCKED` prevents both workers from claiming the same row. The loser moves to the next available delivery. The unique constraint on `event_id` is the final guard against duplicates arriving from Stripe itself.\n\nI'd keep retries capped at eight attempts with jitter, and send anything beyond that to a dead-letter table that the admin panel can replay.",
      },
      {
        role: "tool",
        toolName: "Bash",
        toolDetail: "pnpm test:billing -- webhook-queue",
        content: "14 passing · 2.1s",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "Queue and transactional handler are in place, with tests for concurrent claims, duplicate events, and dead-letter replay. The only remaining operational task is an index on `(status, next_attempt_at)`.",
      },
    ],
  },
  {
    id: "ses_sqlite_discovery",
    agent: "codex",
    title: "SQLite session discovery",
    excerpt: "Read Cursor's state database without mutating it.",
    project: "sessionpal",
    updatedAt: ago({ hours: 7, minutes: 18 }),
    ageMinutes: 7 * 60 + 18,
    durationMinutes: 83,
    model: "gpt-5.1-codex",
    usage: makeUsage("gpt-5.1-codex", 32_000, 12_200, 44_000, 4_000),
    sizeBytes: 27.1 * MB,
    branch: "feat/cursor-discovery",
    messages: [
      {
        role: "user",
        content:
          "Add best-effort discovery for Cursor's composer sessions. The database is SQLite and may be locked while Cursor is running. We must never write to it.",
      },
      {
        role: "assistant",
        content:
          "I'll open `state.vscdb` read-only with `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`, set a short busy timeout, and query `ItemTable` for composer keys. Everything will be parsed defensively because Cursor's payload shape is not a public contract.\n\nIf the database is locked, discovery should skip Cursor and record a note rather than fail the whole scan.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "src-tauri/src/agents/cursor.rs",
        content: "Read 188 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "I'm keeping the parser in its own module with a narrow interface: `discover_cursor(root) -> AgentDiscovery`. That way a Cursor update can break one parser without affecting the other agents.\n\n```rust\nlet conn = Connection::open_with_flags(\n    db_path,\n    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,\n)?;\nconn.busy_timeout(Duration::from_millis(250))?;\n```",
      },
      {
        role: "user",
        content:
          "Make sure sessions have stable IDs so a rescan doesn't create duplicates. Also surface a useful message when no sessions are found.",
      },
      {
        role: "assistant",
        content:
          "Stable IDs come from the composer's own identifier in the JSON payload, prefixed with the database path hash. If Cursor changes its shape, we log a single parse error per key and fall back to no sessions for that workspace.\n\nThe settings UI will show “Cursor detected · no readable sessions” instead of a generic failure. Silent partial success is worse than an honest empty state.",
      },
      {
        role: "tool",
        toolName: "Bash",
        toolDetail: "cargo test cursor_discovery",
        content: "5 passing · 3.2s",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "Cursor discovery is implemented with read-only access, stable IDs, and a fixture covering a nested bubble payload. I left a clear comment that deletion is intentionally unsupported for database-backed sessions.",
      },
    ],
  },
  {
    id: "ses_cleanup_refactor",
    agent: "opencode",
    title: "Session cleanup refactor",
    excerpt: "Add retention rules and prune old threads.",
    project: "sessionpal",
    updatedAt: ago({ days: 4, hours: 2, minutes: 11 }),
    ageMinutes: 98 * 60 + 11,
    durationMinutes: 47,
    model: "gpt-5.1-codex-mini",
    usage: makeUsage("gpt-5.1-codex-mini", 16_000, 6_200, 20_500, 1_800),
    sizeBytes: 9.6 * MB,
    branch: "refactor/cleanup",
    messages: [
      {
        role: "user",
        content:
          "The cleanup flow grew three different confirmation paths. I want one preview → confirm → result flow, and a dry-run mode I can use from the CLI.",
      },
      {
        role: "assistant",
        content:
          "I found the three entry points: the old bulk bar, the per-session menu, and the script. I'll extract a single `deletionPlan` helper that validates every path, then have the UI and CLI share it. Dry run returns the same shape with `applied: false`.",
      },
      {
        role: "tool",
        toolName: "Search",
        toolDetail: "rg \"delete_sessions|confirmDelete\" src src-tauri",
        content: "Found 11 matches across 6 files",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "One safety issue: the Rust command accepts arbitrary paths today, which would let a compromised frontend remove files outside the agent roots. I'm changing it to take locators and validate each one against the discovered root set before touching disk.\n\n```rust\nfn ensure_inside(root: &Path, candidate: &Path) -> Result<()> {\n    let root = root.canonicalize()?;\n    let target = candidate.canonicalize()?;\n    if !target.starts_with(&root) {\n        return Err(DenError::OutsideRoot);\n    }\n    Ok(())\n}\n```",
      },
      {
        role: "user",
        content:
          "Good. Make the confirmation require an explicit acknowledgement, but don't ask people to type DELETE. That feels punitive.",
      },
      {
        role: "assistant",
        content:
          "Agreed. The confirmation now lists the affected files, shows the reclaimed size, and requires one checkbox acknowledgement. The destructive button only enables after that. A toast reports what was removed and the result view can no longer be dismissed into a stale list.",
      },
      {
        role: "assistant",
        content:
          "Cleanup is unified behind one plan object, with dry-run support and root validation. The UI and CLI now report identical results.",
      },
    ],
  },
  {
    id: "ses_dark_tokens",
    agent: "cursor",
    title: "Dark mode token pass",
    excerpt: "Audit every surface for contrast and calm.",
    project: "meridian",
    updatedAt: ago({ days: 5, hours: 5, minutes: 20 }),
    ageMinutes: 125 * 60 + 20,
    durationMinutes: 42,
    model: "composer-1",
    usage: makeUsage("composer-1", 11_000, 3_900, 14_000, 1_000),
    sizeBytes: 6.8 * MB,
    branch: "feat/dark-tokens",
    messages: [
      {
        role: "user",
        content:
          "Do a dark mode pass over the new Meridian tokens. The pastel cards turn muddy and the muted text disappears. Don't just invert everything.",
      },
      {
        role: "assistant",
        content:
          "I'll treat dark mode as its own material, not an inversion. Pastel surfaces become low-chroma umber and olive fields with tinted text; the copper accent gets lighter so it still reads as the same brand. I'll audit WCAG contrast for body copy and controls as I go.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "src/styles/tokens.css",
        content: "Read 240 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "The muddy cards came from keeping the same hue but dropping lightness only. I split each tint into `surface` and `ink` tokens, then adjusted hue slightly toward the warm neutral family for dark. Example:\n\n```css\n.dark {\n  --tint-sage-bg: #252c20;\n  --tint-sage-ink: #cddbbd;\n  --tint-sage-line: #3c4932;\n}\n```",
      },
      {
        role: "user",
        content:
          "The focus ring now looks like a link color on the butter cards. Keep focus visible but quieter.",
      },
      {
        role: "assistant",
        content:
          "Switched focus to a two-layer treatment: a 1px warm outline plus a 3px translucent halo tied to the current surface rather than a fixed accent. It stays above 3:1 on every tint and no longer competes with links.",
      },
      {
        role: "assistant",
        content:
          "Token pass complete across 18 surfaces. I left the deep charcoal workspace intentionally slightly warm; pure neutral next to the copper accent felt synthetic.",
      },
    ],
  },
  {
    id: "ses_flaky_checkout",
    agent: "codex",
    title: "Fix flaky checkout test",
    excerpt: "Stabilize the CI test that fails one run in nine.",
    project: "ledgerly",
    updatedAt: ago({ days: 6, hours: 1, minutes: 33 }),
    ageMinutes: 145 * 60 + 33,
    durationMinutes: 69,
    model: "gpt-5.1-codex",
    usage: makeUsage("gpt-5.1-codex", 24_000, 9_100, 31_000, 3_500),
    sizeBytes: 17.4 * MB,
    branch: "fix/checkout-flake",
    messages: [
      {
        role: "user",
        content:
          "Our checkout test fails about one CI run in nine and I can't reproduce it locally. Find the race, don't just add a retry.",
      },
      {
        role: "assistant",
        content:
          "I'll start with the test history and the mock timers. Adding a retry would hide the defect; if it's a race, it will surface again under load.",
      },
      {
        role: "tool",
        toolName: "Bash",
        toolDetail: "for i in {1..20}; do pnpm test checkout; done",
        content: "19 passed · 1 failed",
        toolStatus: "error",
      },
      {
        role: "assistant",
        content:
          "Reproduced on the 17th run. The test waits for the success screen, but the invoice number request resolves after navigation and updates the same screen. Under load, the assertion catches the intermediate state.\n\nThe fix is to wait for the invoice request to settle, not for the screen to appear. That's also the behavior users experience.",
      },
      {
        role: "tool",
        toolName: "Edit",
        toolDetail: "src/checkout/checkout.test.tsx",
        content: "Wait for settlement, not first paint",
        toolStatus: "ok",
      },
      {
        role: "user",
        content:
          "Nice. Is there a way to make this class of bug visible in dev, without hanging the test forever?",
      },
      {
        role: "assistant",
        content:
          "Added a dev-only activity assertion that fails if a network request starts after a test considers the page settled. It surfaced one other test with the same shape. The test suite runtime moved from 31s to 33s, which is a trade I'd take for the signal.",
      },
      {
        role: "assistant",
        content:
          "Race fixed and verified across 20 runs. The flake was an assertion reading an intermediate render, not the timers we suspected.",
      },
    ],
  },
  {
    id: "ses_export_markdown",
    agent: "claude",
    title: "Export sessions to Markdown",
    excerpt: "Design a readable archive format for long conversations.",
    project: "sessionpal",
    updatedAt: ago({ days: 8, hours: 2, minutes: 47 }),
    ageMinutes: 194 * 60 + 47,
    durationMinutes: 58,
    model: "claude-sonnet-4-5",
    usage: makeUsage("claude-sonnet-4-5", 18_000, 6_500, 23_000, 2_000),
    sizeBytes: 8.2 * MB,
    branch: "feat/markdown-export",
    messages: [
      {
        role: "user",
        content:
          "Design the Markdown export for sessions. It needs to be readable when the original tool is long gone. Include metadata, but don't make the front matter enormous.",
      },
      {
        role: "assistant",
        content:
          "I'd use a compact front matter block (agent, project, model, timestamps, source path) and then a single document with role headings. Tool calls become blockquoted one-liners or details blocks, with the full command but not the full output by default.\n\nFor a long session, the first 300 characters of each user message are enough for a table of contents.",
      },
      {
        role: "tool",
        toolName: "Read",
        toolDetail: "src/lib/export.ts",
        content: "Read 132 lines",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "I'll include raw token usage in the front matter but keep the narrative free of numbers. A person reading this in five years cares about the conversation; a machine can parse the metadata.\n\n```md\n---\nagent: Claude Code\nproject: sessionpal\nmodel: claude-sonnet-4-5\ncreated: 2026-10-27T09:12:00Z\nsource: ~/.claude/projects/...\n---\n\n# Export sessions to Markdown\n\n## You\n...\n```",
      },
      {
        role: "user",
        content:
          "What about tool output that contains terminal escape codes? It looked awful in the first draft.",
      },
      {
        role: "assistant",
        content:
          "Strip ANSI sequences before writing, preserve newlines, and do not attempt to syntax highlight unknown output. I also normalize path separators and redact obvious home directory prefixes to `~` in the copy. The original absolute path stays in the front matter for traceability.",
      },
      {
        role: "assistant",
        content:
          "Export format defined and implemented. The sample archive reads cleanly in Obsidian and GitHub, and non-ASCII session titles round-trip without mangling.",
      },
    ],
  },
  {
    id: "ses_restore_safety",
    agent: "opencode",
    title: "Backup restore safety",
    excerpt: "Make restores reversible before touching disk.",
    project: "sessionpal",
    updatedAt: ago({ days: 12, hours: 6, minutes: 15 }),
    ageMinutes: 294 * 60 + 15,
    durationMinutes: 36,
    model: "kimi-k2",
    usage: makeUsage("kimi-k2", 13_000, 5_400, 18_000, 1_200),
    sizeBytes: 7.1 * MB,
    branch: "feat/restore-safety",
    messages: [
      {
        role: "user",
        content:
          "Restore currently overwrites files. Before we ship it, make the operation reversible and reject any archive path that escapes the agent roots.",
      },
      {
        role: "assistant",
        content:
          "I'll stage the archive in the app data directory, build a restore plan from the manifest, and snapshot every file that would be replaced into an automatic safety backup first. Only then do we copy in. If anything fails, the original files are restored from the snapshot.",
      },
      {
        role: "tool",
        toolName: "Write",
        toolDetail: "src-tauri/src/backup/restore.rs",
        content: "Created staged restore flow (204 lines)",
        toolStatus: "ok",
      },
      {
        role: "assistant",
        content:
          "Validation is intentionally strict: each archive entry must be relative, free of `..`, and map to a known agent root from the manifest. The manifest is read before any file is written, so a crafted archive cannot choose its own destination.\n\n```rust\nif entry.enclosed_name().is_none() {\n    return Err(DenError::UnsafeArchivePath);\n}\n```",
      },
      {
        role: "user",
        content:
          "Good. Keep the safety backup out of the backup history so it doesn't confuse people, but tell them where it lives.",
      },
      {
        role: "assistant",
        content:
          "The snapshot is stored under `backups/safety/` with a timestamp and not listed in the main history. The restore dialog links to it and the success toast says it can be removed once the restored sessions look right.",
      },
      {
        role: "assistant",
        content:
          "Restore is now staged, validated, and reversible. Tests cover traversal attempts, partial copy failures, and a successful round-trip.",
      },
    ],
  },
];

const FEATURED: SessionDetail[] = FEATURED_RAW.map(distribute);
const featuredIds = new Set(FEATURED.map((session) => session.id));

/* ------------------------------------------------------------------ */
/* Generated library metadata                                          */
/* ------------------------------------------------------------------ */

const COUNTS: Record<AgentId, number> = {
  claude: 1284,
  codex: 863,
  cursor: 516,
  opencode: 183,
  antigravity: 241,
};

const ACTIONS = [
  "Add",
  "Fix",
  "Refactor",
  "Polish",
  "Debug",
  "Speed up",
  "Redesign",
  "Test",
  "Document",
  "Simplify",
  "Migrate",
  "Harden",
  "Instrument",
  "Optimize",
  "Review",
  "Rebuild",
  "Tune",
  "Wire up",
  "Clean up",
  "Validate",
  "Cache",
  "Stream",
  "Rewrite",
  "Audit",
];

const SUBJECTS = [
  "command palette search",
  "empty states",
  "settings persistence",
  "token usage charts",
  "JSONL parsing",
  "the backup restore flow",
  "dark mode contrast",
  "window drag regions",
  "session export",
  "keyboard shortcuts",
  "SQLite discovery",
  "cost estimation",
  "tool call rendering",
  "sidebar transitions",
  "the onboarding flow",
  "error boundaries",
  "file reveal actions",
  "date grouping",
  "search ranking",
  "streaming responses",
  "markdown rendering",
  "agent detection",
  "prompt caching",
  "bundle splitting",
  "theme tokens",
  "path validation",
  "the session detail layout",
  "usage aggregation",
  "filter state",
  "scroll restoration",
  "type-safe settings",
  "backup manifests",
  "retry handling",
  "large transcripts",
  "sidebar navigation",
  "the overview chart",
  "tool output formatting",
  "token pricing",
  "local storage",
  "the empty dashboard",
  "WebSocket reconnects",
  "image uploads",
  "accessibility labels",
  "gesture handling",
  "route transitions",
  "the release checklist",
  "test fixtures",
  "error copy",
];

const EXCERPTS = [
  "A focused pass with tests around the tricky edges.",
  "Read the surrounding code, then shipped the smallest safe change.",
  "Iterated on the implementation until the behavior felt predictable.",
  "Traced the issue first; the fix stayed small.",
  "Explored two approaches before committing to one.",
  "Tightened the implementation and removed a stale workaround.",
  "Mostly cleanup, plus one meaningful performance win.",
  "Added the missing pieces and verified the full path.",
  "Rewrote the fragile section and kept every existing contract.",
  "Paired on the approach, then implemented and tested it.",
  "A quiet refactor with a handful of new edge-case tests.",
  "The change touched more files than expected; kept the diff reviewable.",
];

const BRANCH_WORDS = [
  "feat",
  "fix",
  "refactor",
  "chore",
  "perf",
  "test",
  "polish",
];

const projects = PROJECTS;

function titleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function chooseModel(agent: AgentId, rand: () => number): string {
  const options = modelsForAgent(agent);
  let cursor = rand();
  for (const option of options) {
    if (cursor <= option.weight) return option.id;
    cursor -= option.weight;
  }
  return options[0].id;
}

function generateFiller(agent: AgentId, index: number, seedNumber: number): SessionSummary {
  const rand = seeded(seedNumber);
  const project = pick(rand, projects);
  const title = `${pick(rand, ACTIONS)} ${pick(rand, SUBJECTS)}`;
  const model = chooseModel(agent, rand);
  const hasUsage = rand() > 0.065;
  const input = round(4_000 + Math.pow(rand(), 1.5) * 88_000);
  const output = round(900 + Math.pow(rand(), 2.1) * 24_000);
  const cacheRead = round(input * (0.25 + rand() * 2.8));
  const cacheWrite = round(input * rand() * 0.12);
  const usage = hasUsage ? makeUsage(model, input, output, cacheRead, cacheWrite) : null;
  const ageDays = 365 * Math.pow(rand(), 1.55);
  const ageMinutes = Math.round(ageDays * 1440) + 8 * 60 + Math.round(rand() * 180);
  const updatedAt = new Date(NOW - ageMinutes * MINUTE).toISOString();
  const durationMinutes = round(4 + rand() * 160);
  const createdAt = new Date(NOW - (ageMinutes + durationMinutes) * MINUTE).toISOString();
  const messageCount = 6 + Math.floor(rand() * 15);
  const branch = rand() > 0.17 ? `${pick(rand, BRANCH_WORDS)}/${titleSlug(title)}` : null;
  const sizeBytes = Math.round((0.18 + Math.pow(rand(), 3) * 24) * MB);
  const id = `ses_${agent}_${String(index + 1).padStart(4, "0")}`;
  const format: SessionSummary["format"] =
    AGENTS[agent].storageKind === "SQLite" ? "sqlite" : agent === "opencode" ? "json" : "jsonl";

  return {
    id,
    agent,
    title,
    excerpt: pick(rand, EXCERPTS),
    project: project.slug,
    projectLabel: project.label,
    cwd: `~/Projects/${project.slug}`,
    branch,
    createdAt,
    updatedAt,
    messageCount,
    tokens: usageTokens(usage),
    sizeBytes,
    model,
    models: [model],
    usage,
    format,
    path: demoPath(agent, project.slug, id),
    deletable: true,
    demo: true,
    tint: project.tint,
    icon: project.icon,
  };
}

const filler: SessionSummary[] = [];
let seedNumber = 42_117;
for (const agent of AGENT_ORDER) {
  const featuredCount = FEATURED.filter((session) => session.agent === agent).length;
  const total = COUNTS[agent] - featuredCount;
  for (let i = 0; i < total; i += 1) {
    seedNumber += 7919;
    filler.push(generateFiller(agent, i, seedNumber));
  }
}

function dateKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** Spread a sample session's usage evenly across the local days it spans. */
function withUsageDays(session: SessionSummary): SessionSummary {
  const usage = session.usage;
  if (!usage) return session;
  const keys: string[] = [];
  const day = new Date(session.createdAt);
  day.setHours(0, 0, 0, 0);
  const last = new Date(session.updatedAt);
  while (day <= last && keys.length < 400) {
    keys.push(dateKey(day));
    day.setDate(day.getDate() + 1);
  }
  if (!keys.length) return session;
  const share = (value: number, index: number) => {
    const base = Math.floor(value / keys.length);
    return index === keys.length - 1 ? value - base * (keys.length - 1) : base;
  };
  const usageDays: DayUsage[] = keys.map((key, index) => ({
    day: key,
    input: share(usage.input, index),
    output: share(usage.output, index),
    cacheRead: share(usage.cacheRead, index),
    cacheWrite: share(usage.cacheWrite, index),
    cost: usage.cost === null ? null : usage.cost / keys.length,
  }));
  return { ...session, usageDays };
}

/**
 * Mirrors the desktop app's project grouping so the preview shows the cases
 * it handles: worktree sessions count toward their main repository, and two
 * repositories with the same folder name are told apart by their parent.
 */
function withProjectRoots(sessions: SessionSummary[]): SessionSummary[] {
  const placed = sessions.map((session, index) => {
    const repo = session.cwd;
    if (session.demo && index % 9 === 4 && session.branch) {
      // A session that ran in a linked worktree of the same repository.
      const tree = session.branch.split("/").pop() ?? "feature";
      return { ...session, cwd: `${repo}/.claude/worktrees/${tree}`, projectRoot: repo };
    }
    if (session.project === "api-core" && index % 4 === 1) {
      // A second, unrelated checkout that happens to share the folder name.
      const other = "~/Clients/northwind/api-core";
      return { ...session, cwd: other, projectRoot: other };
    }
    return { ...session, projectRoot: repo };
  });
  const rootsByLabel = new Map<string, Set<string>>();
  for (const session of placed) {
    const roots = rootsByLabel.get(session.projectLabel) ?? new Set<string>();
    roots.add(session.projectRoot);
    rootsByLabel.set(session.projectLabel, roots);
  }
  return placed.map((session) => {
    const shared = (rootsByLabel.get(session.projectLabel)?.size ?? 0) > 1;
    const parent = session.projectRoot.split("/").slice(-2, -1)[0];
    return {
      ...session,
      projectRootLabel: shared && parent ? `${session.projectLabel} · ${parent}` : session.projectLabel,
    };
  });
}

export const DEMO_SESSIONS: SessionSummary[] = withProjectRoots([...FEATURED, ...filler].map(withUsageDays)).sort(
  (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
);

export const DEMO_SESSION_COUNT = DEMO_SESSIONS.length;
export const DEMO_TOTAL_STORAGE = DEMO_SESSIONS.reduce((sum, session) => sum + session.sizeBytes, 0);

/* ------------------------------------------------------------------ */
/* Procedural transcripts for generated sessions                       */
/* ------------------------------------------------------------------ */

const OPENERS = [
  (title: string, project: string) =>
    `Can you ${lower(title)}? Keep the change focused and add tests around the edge cases. I'm working in ${project}.`,
  (title: string, project: string) =>
    `Let's work on ${lower(title)} in ${project}. Start by reading the relevant code paths, then propose the smallest safe change before editing anything.`,
  (title: string, project: string) =>
    `I want to ${lower(title)}. There are a few conventions in this repo I don't want to break, so please look around first.`,
  (title: string, project: string) =>
    `Take a look at ${lower(title)} for me. The current implementation works, but it's getting brittle and I'd rather fix the shape than add another workaround. Project: ${project}.`,
  (title: string, project: string) =>
    `We need to ${lower(title)} before the next release. Show me the plan first; no broad refactors unless they remove real complexity.`,
  (title: string, project: string) =>
    `Something feels off around ${lower(title)}. Can you reproduce it, find the root cause, and only then write a fix?`,
];

const PLANS = [
  "I'll start by mapping the call sites, then make the change behind the existing interface so the rest of the app keeps working.",
  "First pass: read the relevant files, find the smallest seam, and write a failing test that describes the expected behavior.",
  "I found the relevant path. The current code mixes state and rendering, so I'll separate the pure part first and keep the visual change minimal.",
  "There are two places that own this behavior. I'll verify which one is authoritative before changing anything, then add coverage for the boundary.",
  "This is a small surface area once you trace it. I'll make the change, verify the failure mode is gone, and keep the public API untouched.",
  "I'll read the surrounding implementation and the existing tests before proposing a plan. The goal is a reviewable diff, not a rewrite.",
];

const FOLLOW_UPS = [
  "That mostly works. Can you handle the case where the user navigates away while the request is still in flight?",
  "Good. One more thing: keep the empty state readable when the title is very long, and check the narrow layout.",
  "Makes sense. Add a regression test for the exact case we just hit, then run the surrounding suite.",
  "I like the direction. Can you remove the temporary workaround now, or is it still doing something useful?",
  "The behavior is right, but the error message is vague. Make it tell the user what actually happened and what to do next.",
  "Can you also check keyboard focus after the transition? It feels like focus is getting lost.",
  "Let's tighten the copy and make sure nothing is announced twice to a screen reader.",
  "Before we finish, verify the change against a clean install and note anything that still depends on local state.",
];

const SUMMARIES = [
  "Done. The change is in place with coverage for the failure path and the main flow. I also removed one stale branch that could no longer be reached.",
  "The fix is complete. I verified the behavior locally and left the broader refactor for a separate change; it would have obscured this one.",
  "Implemented and tested. The surface stays the same, but the internal boundary is easier to reason about now.",
  "This is ready. The key detail is that the state now settles before the view commits, which removes the flicker you were seeing.",
  "All set. I kept the empty state explicit instead of hiding it, and added one integration test so the behavior stays honest.",
  "Finished. Nothing else references the old path, so I removed it rather than leaving a second way to do the same thing.",
];

const TOOL_ACTIONS = [
  (slug: string) => ({
    toolName: "Read",
    toolDetail: `src/${slug}/components/panel.tsx`,
    content: "Read 184 lines",
  }),
  (slug: string) => ({
    toolName: "Search",
    toolDetail: `rg -n "TODO|FIXME" src/${slug}`,
    content: "Found 7 matches in 4 files",
  }),
  (slug: string) => ({
    toolName: "Bash",
    toolDetail: `pnpm test -- ${slug} --run`,
    content: "12 passing · 1.8s",
  }),
  (slug: string) => ({
    toolName: "Edit",
    toolDetail: `src/${slug}/lib/state.ts`,
    content: "Updated 3 hunks",
  }),
  (slug: string) => ({
    toolName: "Bash",
    toolDetail: `pnpm typecheck`,
    content: "No type errors",
  }),
  (slug: string) => ({
    toolName: "Read",
    toolDetail: `docs/architecture.md`,
    content: "Read 96 lines",
  }),
  (slug: string) => ({
    toolName: "Bash",
    toolDetail: `git diff --stat`,
    content: "6 files changed · 214 insertions · 61 deletions",
  }),
];

function lower(value: string): string {
  if (!value) return value;
  return value[0].toLowerCase() + value.slice(1);
}

function generateTranscript(session: SessionSummary): Message[] {
  const rand = seeded(hashId(session.id));
  const project = session.projectLabel;
  const openers = OPENERS.map((fn) => fn(session.title, project));
  const tools = TOOL_ACTIONS.map((fn) => fn(session.project));
  const total = Math.max(6, session.messageCount);
  const messages: MessageSeed[] = [];
  const start = new Date(session.createdAt).getTime();
  const end = new Date(session.updatedAt).getTime();

  for (let i = 0; i < total; i += 1) {
    let message: MessageSeed;
    if (i === 0) {
      message = { role: "user", content: pick(rand, openers) };
    } else if (i === 1) {
      message = { role: "assistant", content: pick(rand, PLANS) };
    } else if (i === total - 1) {
      message = { role: "assistant", content: pick(rand, SUMMARIES) };
    } else if (i % 4 === 2) {
      const tool = pick(rand, tools);
      message = { role: "tool", toolStatus: "ok", ...tool };
    } else if (i % 4 === 3) {
      message = {
        role: "assistant",
        content:
          i % 8 === 3
            ? `The important constraint is that \`${session.project}\` must keep working without the new behavior enabled. I'm putting the change behind the existing feature boundary and checking the fallback path as well.`
            : "I traced the path end to end. The issue was a stale value captured by the component before the async boundary, so the UI committed one frame behind the source of truth. The fix removes that second copy instead of trying to synchronize it.",
      };
    } else if (i % 2 === 0) {
      message = {
        role: "user",
        content:
          i % 6 === 0
            ? pick(rand, FOLLOW_UPS)
            : `Looks good. Can you also verify the behavior with an empty dataset, and make sure the loading state doesn't flash?`,
      };
    } else {
      message = {
        role: "assistant",
        content:
          i % 8 === 7
            ? "Added that coverage. The empty path renders a composed state rather than an invisible panel, and the loading skeleton preserves the final layout dimensions, so there's no jump when data arrives."
            : "Updated. I removed the duplicated state, kept the transition interruptible, and verified focus returns to the trigger when the panel closes.",
      };
    }
    messages.push(message);
  }

  return messages.map((message, index) => {
    const ratio = total > 1 ? index / (total - 1) : 0;
    const timestamp = new Date(start + (end - start) * ratio).toISOString();
    return {
      ...message,
      id: `${session.id}_m${index}`,
      timestamp,
      model: message.role === "assistant" ? session.model ?? undefined : undefined,
      tokens:
        message.role === "assistant" && session.usage
          ? Math.round(
              (session.usage.input + session.usage.output + session.usage.cacheRead) / total,
            )
          : undefined,
    };
  });
}

function hashId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const detailCache = new Map<string, SessionDetail>();
for (const session of FEATURED) {
  detailCache.set(session.id, session);
}

/** Searches the sample conversations, which have full transcripts. */
export function demoContentSearch(query: string): ContentHit[] {
  return searchMessages(FEATURED, query);
}

export function demoSessionDetail(id: string): SessionDetail | null {
  const cached = detailCache.get(id);
  if (cached) return cached;
  const summary = DEMO_SESSIONS.find((session) => session.id === id);
  if (!summary) return null;
  const messages = generateTranscript(summary);
  const detail: SessionDetail = {
    ...summary,
    messages,
    messageCount: messages.length,
    durationMs: Math.max(
      1,
      new Date(summary.updatedAt).getTime() - new Date(summary.createdAt).getTime(),
    ),
  };
  detailCache.set(id, detail);
  return detail;
}

/* ------------------------------------------------------------------ */
/* Backups                                                             */
/* ------------------------------------------------------------------ */

const totalDemoSize = DEMO_TOTAL_STORAGE;

export const DEMO_BACKUPS: BackupRecord[] = [
  {
    id: "bkp_before_cleanup",
    name: "Before the cleanup",
    createdAt: ago({ hours: 3, minutes: 18 }),
    sizeBytes: 4.34 * 1024 * MB,
    sessionCount: 2846,
    agents: ["claude", "codex", "cursor", "opencode", "antigravity"],
    fileCount: 6284,
    path: "~/Library/Application Support/SessionPal/backups/before-the-cleanup.zip",
    demo: true,
  },
  {
    id: "bkp_full_library",
    name: "Full library",
    createdAt: ago({ days: 2, hours: 5 }),
    sizeBytes: 4.21 * 1024 * MB,
    sessionCount: 2831,
    agents: ["claude", "codex", "cursor", "opencode"],
    fileCount: 6210,
    path: "~/Library/Application Support/SessionPal/backups/full-library.zip",
    demo: true,
  },
  {
    id: "bkp_before_upgrade",
    name: "Before app upgrade",
    createdAt: ago({ days: 9, hours: 1 }),
    sizeBytes: 3.98 * 1024 * MB,
    sessionCount: 2712,
    agents: ["claude", "codex", "cursor"],
    fileCount: 5894,
    path: "~/Library/Application Support/SessionPal/backups/before-app-upgrade.zip",
    demo: true,
  },
  {
    id: "bkp_codex_migration",
    name: "After Codex migration",
    createdAt: ago({ days: 21, hours: 7 }),
    sizeBytes: 3.71 * 1024 * MB,
    sessionCount: 2480,
    agents: ["claude", "codex", "opencode"],
    fileCount: 5128,
    path: "~/Library/Application Support/SessionPal/backups/after-codex-migration.zip",
    demo: true,
  },
  {
    id: "bkp_october",
    name: "October archive",
    createdAt: ago({ days: 46, hours: 2 }),
    sizeBytes: 3.42 * 1024 * MB,
    sessionCount: 2214,
    agents: ["claude", "codex", "cursor", "opencode"],
    fileCount: 4716,
    path: "~/Library/Application Support/SessionPal/backups/october-archive.zip",
    demo: true,
  },
  {
    id: "bkp_first_import",
    name: "Initial local import",
    createdAt: ago({ days: 87, hours: 4 }),
    sizeBytes: 2.96 * 1024 * MB,
    sessionCount: 1874,
    agents: ["claude", "codex", "cursor", "opencode"],
    fileCount: 3921,
    path: "~/Library/Application Support/SessionPal/backups/initial-local-import.zip",
    demo: true,
  },
];

export const DEMO_ACTIVITY: ActivityEvent[] = ([
  {
    id: "act_1",
    kind: "session",
    title: "Roadster thruster prototype",
    detail: "New Claude Code session · 126.4k tokens",
    at: ago({ hours: 2, minutes: 6 }),
    agent: "claude",
  },
  {
    id: "act_2",
    kind: "backup",
    title: "Backup created",
    detail: "Before the cleanup · 4.34 GB",
    at: ago({ hours: 3, minutes: 18 }),
  },
  {
    id: "act_3",
    kind: "export",
    title: "12 sessions exported",
    detail: "Markdown · atlas-api",
    at: ago({ hours: 9, minutes: 52 }),
  },
  {
    id: "act_4",
    kind: "session",
    title: "Billing webhook retry queue",
    detail: "Claude Code · 182.4k tokens",
    at: ago({ hours: 6, minutes: 24 }),
    agent: "claude",
  },
  {
    id: "act_5",
    kind: "delete",
    title: "3 sessions removed",
    detail: "144 MB reclaimed",
    at: ago({ days: 1, hours: 7 }),
  },
  {
    id: "act_6",
    kind: "scan",
    title: "Discovery scan complete",
    detail: "2,846 sessions across 4 agents",
    at: ago({ days: 2, hours: 5 }),
  },
] satisfies ActivityEvent[]).sort(
  (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
);

/* ------------------------------------------------------------------ */
/* Derived demo facts                                                  */
/* ------------------------------------------------------------------ */

export const DEMO_AGENT_COUNTS: Record<AgentId, number> = DEMO_SESSIONS.reduce(
  (counts, session) => {
    counts[session.agent] += 1;
    return counts;
  },
  { claude: 0, codex: 0, cursor: 0, opencode: 0, antigravity: 0 } as Record<AgentId, number>,
);

export const DEMO_TOTAL_BACKUP_SIZE = DEMO_BACKUPS.reduce(
  (total, backup) => total + backup.sizeBytes,
  0,
);

export const DEMO_HEALTH = {
  sessionCount: DEMO_SESSIONS.length,
  storageBytes: totalDemoSize,
  lastScanAt: new Date(NOW - 4 * MINUTE).toISOString(),
};

export { FEATURED };
