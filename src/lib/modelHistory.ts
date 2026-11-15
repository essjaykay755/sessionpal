import type { AgentId, Message, SessionSummary } from "./types";

/** Model changes observed between consecutively identified assistant messages. */
export function modelChanges(agent: AgentId, messages: Message[]): Map<string, string> {
  const changes = new Map<string, string>();
  // Cursor may substitute a session-level model for missing message metadata.
  // Antigravity's generation metadata is not linked to transcript messages.
  if (agent === "cursor" || agent === "antigravity") return changes;
  let previous: string | undefined;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const model = message.model?.trim() || undefined;
    if (model && previous && model !== previous) changes.set(message.id, model);
    previous = model;
  }
  return changes;
}

export function detectedModels(session: Pick<SessionSummary, "models" | "model">): string[] {
  return [...new Set([...(session.models ?? []), session.model].filter((model): model is string => !!model))];
}
