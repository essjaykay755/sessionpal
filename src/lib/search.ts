import { AGENTS } from "./agents";
import type { SessionSummary } from "./types";

/** Placeholder shared by every session list, so the same search behaves the same everywhere. */
export const SESSION_SEARCH_PLACEHOLDER = "Search title, project, model…";

export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Matches when every token appears somewhere in the session's metadata. */
export function matchesSession(session: SessionSummary, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = [
    session.title,
    session.excerpt,
    session.projectLabel,
    session.cwd,
    session.branch ?? "",
    session.model ?? "",
    session.path,
    AGENTS[session.agent].name,
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}
