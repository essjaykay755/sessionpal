import { AGENTS } from "./agents";
import type { ContentHit, SessionDetail, SessionSummary } from "./types";

/** Placeholder shared by every session list, so the same search behaves the same everywhere. */
export const SESSION_SEARCH_PLACEHOLDER = "Search titles, projects and conversations…";

export const MARK_START = "\u0001";
export const MARK_END = "\u0002";

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

/** The words a conversation search looks for, the way the native index reads them. */
export function contentWords(query: string): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/** Splits a snippet into plain and matched parts. */
export function snippetParts(snippet: string): Array<{ text: string; hit: boolean }> {
  const parts: Array<{ text: string; hit: boolean }> = [];
  let hit = false;
  let text = "";
  for (const character of snippet) {
    if (character === MARK_START || character === MARK_END) {
      if (text) parts.push({ text, hit });
      text = "";
      hit = character === MARK_START;
    } else {
      text += character;
    }
  }
  if (text) parts.push({ text, hit });
  return parts;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches whole words starting with any of `words` in lowercased text. Group 1
 * is the boundary before the word and group 2 the word. (No lookbehind: older
 * macOS WebKit does not support it.)
 */
export function wordStartPattern(words: string[]): RegExp | null {
  const lower = words.map((word) => word.toLowerCase()).filter(Boolean);
  if (lower.length === 0) return null;
  return new RegExp(`(^|[^\\p{L}\\p{N}])((?:${lower.map(escapeRegExp).join("|")})[\\p{L}\\p{N}]*)`, "gu");
}

/**
 * The browser preview has no native index, so its sample conversations are
 * searched here with the same rules: every word, as a word prefix, in one message.
 */
export function searchMessages(details: SessionDetail[], query: string, limit = 200): ContentHit[] {
  const words = contentWords(query).map(fold);
  if (words.length === 0) return [];
  const starts = words.map((word) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(word)}`, "u"));
  const hits: ContentHit[] = [];
  for (const detail of details) {
    let best: ContentHit | null = null;
    for (const message of detail.messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      const folded = fold(message.content);
      if (!starts.every((pattern) => pattern.test(folded))) continue;
      if (best) {
        best.matches += 1;
        continue;
      }
      best = {
        id: detail.id,
        agent: detail.agent,
        messageId: message.id,
        role: message.role,
        snippet: makeSnippet(message.content, words),
        matches: 1,
      };
    }
    if (best) hits.push(best);
  }
  return hits.slice(0, limit);
}

function makeSnippet(content: string, words: string[]): string {
  const tokens = content.split(/\s+/).filter(Boolean);
  const isHit = (token: string) => {
    const folded = fold(token).replace(/^[^\p{L}\p{N}]+/u, "");
    return words.some((word) => folded.startsWith(word));
  };
  const first = Math.max(0, tokens.findIndex(isHit));
  const start = Math.max(0, first - 6);
  const end = Math.min(tokens.length, start + 18);
  const body = tokens
    .slice(start, end)
    .map((token) => (isHit(token) ? `${MARK_START}${token}${MARK_END}` : token))
    .join(" ");
  return `${start > 0 ? "…" : ""}${body}${end < tokens.length ? "…" : ""}`;
}
