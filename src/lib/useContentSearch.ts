import { useEffect, useRef, useState } from "react";
import { demoContentSearch } from "./demo";
import { fetchSearchIndexStatus, isTauri, onSearchIndexChange, searchConversations } from "./native";
import { contentWords } from "./search";
import type { ContentHit, SearchIndexStatus } from "./types";

const DEBOUNCE_MS = 180;

export interface ContentSearch {
  /** Matches by session ID. Empty when the query is empty. */
  hits: Map<string, ContentHit>;
  searching: boolean;
  /** Set while the index is still being built, so results may grow. */
  indexing: SearchIndexStatus | null;
}

/**
 * Searches conversation text for `query`. Results arrive after a short pause
 * in typing, and are searched again whenever the index changes, including
 * after a rescan that starts or finishes while the query is open.
 */
export function useContentSearch(query: string, native: boolean): ContentSearch {
  const [hits, setHits] = useState<Map<string, ContentHit>>(() => new Map());
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState<SearchIndexStatus | null>(null);
  const [revision, setRevision] = useState(0);
  const latest = useRef(0);
  const searched = useRef("");
  const text = contentWords(query).join(" ");
  const live = native && isTauri;

  // The backend reports every change to the index; each one re-runs the search.
  useEffect(() => {
    if (!live) {
      setIndexing(null);
      return;
    }
    let stopped = false;
    let unlisten: (() => void) | null = null;
    const refresh = async () => {
      try {
        const status = await fetchSearchIndexStatus();
        if (!stopped) setIndexing(status.building && status.total > 0 ? status : null);
      } catch {
        if (!stopped) setIndexing(null);
      }
    };
    void onSearchIndexChange(() => {
      if (stopped) return;
      setRevision((value) => value + 1);
      void refresh();
    }).then((stop) => {
      if (stopped) stop();
      else {
        unlisten = stop;
        // A change may have happened while the listener was registering.
        setRevision((value) => value + 1);
        void refresh();
      }
    }).catch(() => {
      if (!stopped) setIndexing(null);
    });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [live]);

  useEffect(() => {
    if (!text) {
      latest.current += 1;
      searched.current = "";
      setHits(new Map());
      setSearching(false);
      return;
    }
    const request = ++latest.current;
    // Refreshes after an index change keep showing the current results quietly.
    if (searched.current !== text) setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = live ? await searchConversations(text) : demoContentSearch(text);
        if (request !== latest.current) return;
        searched.current = text;
        setHits(new Map(found.map((hit) => [hit.id, hit])));
      } catch {
        if (request === latest.current) setHits(new Map());
      } finally {
        if (request === latest.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, live, revision]);

  return { hits, searching, indexing };
}
