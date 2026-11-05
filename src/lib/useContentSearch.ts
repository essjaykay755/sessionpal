import { useEffect, useRef, useState } from "react";
import { demoContentSearch } from "./demo";
import { fetchSearchIndexStatus, isTauri, searchConversations } from "./native";
import { contentWords } from "./search";
import type { ContentHit, SearchIndexStatus } from "./types";

const DEBOUNCE_MS = 180;
const POLL_MS = 1500;

export interface ContentSearch {
  /** Matches by session ID. Empty when the query is empty. */
  hits: Map<string, ContentHit>;
  searching: boolean;
  /** Set while the index is still being built, so results may grow. */
  indexing: SearchIndexStatus | null;
}

/**
 * Searches conversation text for `query`. Results arrive after a short pause
 * in typing, and are refreshed while the index is still being built.
 */
export function useContentSearch(query: string, native: boolean): ContentSearch {
  const [hits, setHits] = useState<Map<string, ContentHit>>(() => new Map());
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState<SearchIndexStatus | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const text = contentWords(query).join(" ");

  useEffect(() => {
    if (!text) {
      latest.current += 1;
      setHits(new Map());
      setSearching(false);
      return;
    }
    const request = ++latest.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = native && isTauri ? await searchConversations(text) : demoContentSearch(text);
        if (request !== latest.current) return;
        setHits(new Map(found.map((hit) => [hit.id, hit])));
      } catch {
        if (request === latest.current) setHits(new Map());
      } finally {
        if (request === latest.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, native, tick]);

  // While the index is being built, check on it and search again as it grows.
  useEffect(() => {
    if (!text || !native || !isTauri) {
      setIndexing(null);
      return;
    }
    let stopped = false;
    let timer = 0;
    let first = true;
    const check = async () => {
      try {
        const status = await fetchSearchIndexStatus();
        if (stopped) return;
        const building = status.building && status.total > 0;
        setIndexing(building ? status : null);
        // The first check runs alongside the first search; later ones refresh it.
        if (!first) setTick((value) => value + 1);
        first = false;
        if (building) timer = window.setTimeout(check, POLL_MS);
      } catch {
        if (!stopped) setIndexing(null);
      }
    };
    void check();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [text, native]);

  return { hits, searching, indexing };
}
