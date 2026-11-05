import type { ComponentType } from "react";
import type { IconProps } from "@phosphor-icons/react";
import { AGENT_CLASS } from "../lib/agents";
import type { AgentId } from "../lib/types";
import { cn } from "../lib/utils";

/**
 * A session's project icon with a thin agent-coloured edge. The same edge marks
 * sessions everywhere, so the agent reads at a glance without a badge.
 */
export function SessionGlyph({
  agent,
  icon: Icon,
  size = "md",
}: {
  agent: AgentId;
  icon: ComponentType<IconProps>;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        AGENT_CLASS[agent],
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-line/[0.045] text-muted",
        size === "md" ? "h-9 w-9 rounded-[11px]" : "h-8 w-8 rounded-[9px]",
      )}
    >
      <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--agent)]" aria-hidden="true" />
      <Icon className={size === "md" ? "h-[17px] w-[17px]" : "h-[14px] w-[14px]"} />
    </span>
  );
}
