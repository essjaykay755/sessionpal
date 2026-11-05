import type { SVGProps } from "react";
import antigravityMark from "../assets/agents/antigravity.svg?raw";
import claudeMark from "../assets/agents/claude.svg?raw";
import codexMark from "../assets/agents/codex.svg?raw";
import cursorMark from "../assets/agents/cursor.svg?raw";
import opencodeMark from "../assets/agents/opencode.svg?raw";
import type { AgentId } from "../lib/types";
import { cn } from "../lib/utils";

export function BrandMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      // The default size applies only when the caller sets none: `cn` does not
      // resolve conflicting utilities, so both sizes would otherwise compete.
      className={cn(!/(^|\s)h-/.test(className ?? "") && "h-6 w-6", className)}
      aria-hidden="true"
      {...props}
    >
      <g stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 12.5 11.5 4.5h25l7 8" />
        <path d="M4.5 16h39" />
        <path d="M8 25h35" />
        <path d="M8 33h32" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-black tracking-[-0.055em] text-fg", className)}>
      SessionPal
    </span>
  );
}

export function AgentMark({
  agent,
  className,
}: {
  agent: AgentId;
  className?: string;
}) {
  const marks: Record<AgentId, string> = {
    claude: claudeMark,
    codex: codexMark,
    cursor: cursorMark,
    opencode: opencodeMark,
    antigravity: antigravityMark,
  };
  return (
    <span
      aria-hidden="true"
      className={cn("agent-mark inline-block h-5 w-5 shrink-0", className)}
      dangerouslySetInnerHTML={{ __html: marks[agent] }}
    />
  );
}
