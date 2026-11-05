import changelogSource from "../../CHANGELOG.md?raw";
import { version } from "../../package.json";

/**
 * Who makes SessionPal and where to find it. Links left empty are hidden, so
 * the app never shows a placeholder URL.
 */
export const APP_INFO = {
  name: "SessionPal",
  version,
  tagline: "A local-first library for AI coding sessions.",
  developer: "Subhojit Karmakar",
  developerUrl: "https://essjaykay.dev",
  websiteUrl: "https://sessionpal.app",
  license: "MIT",
  copyrightYear: 2026,
} as const;

export interface ReleaseSection {
  title: string;
  items: string[];
}

export interface Release {
  version: string;
  date: string | null;
  summary: string | null;
  sections: ReleaseSection[];
}

const RELEASE_HEADING = /^##\s+\[?([^\]\s]+)\]?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const ITEM = /^\s*[-*]\s+(.+)$/;

/** Reads `## [x.y.z] - YYYY-MM-DD` releases from a Keep a Changelog file. */
export function parseChangelog(source: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: ReleaseSection | null = null;

  for (const line of source.split("\n")) {
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      release = { version: heading[1], date: heading[2] ?? null, summary: null, sections: [] };
      section = null;
      releases.push(release);
      continue;
    }
    if (!release) continue;

    const sectionHeading = SECTION_HEADING.exec(line);
    if (sectionHeading) {
      section = { title: sectionHeading[1], items: [] };
      release.sections.push(section);
      continue;
    }

    const item = ITEM.exec(line);
    if (item && section) {
      section.items.push(item[1].trim());
    } else if (item) {
      // A list before any ### heading still belongs to the release.
      section = { title: "Changes", items: [item[1].trim()] };
      release.sections.push(section);
    } else if (line.trim() && !section && !release.summary) {
      release.summary = line.trim();
    }
  }

  return releases.filter((entry) => entry.version.toLowerCase() !== "unreleased");
}

export const RELEASES = parseChangelog(changelogSource);

export function formatReleaseDate(date: string | null): string {
  if (!date) return "Unreleased";
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
