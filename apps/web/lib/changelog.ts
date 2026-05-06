import { RAW_CHANGELOG } from "./changelog-data.generated";

export type ChangelogSection = {
  /** "Added" | "Changed" | "Fixed" | etc. — verbatim from `### <kind>` heading. */
  kind: string;
  bullets: string[];
};

export type ChangelogEntry = {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
};

const VERSION_HEADING = /^##\s+\[([^\]]+)\](?:\s+[—\-–]\s+(\S+))?\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const BULLET = /^[-*]\s+(.+?)\s*$/;

export function parseChangelog(raw: string): ChangelogEntry[] {
  const lines = raw.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;
  let bulletBuf: string[] = [];

  function flushBullet(): void {
    if (section && bulletBuf.length > 0) {
      section.bullets.push(bulletBuf.join(" ").trim());
      bulletBuf = [];
    }
  }

  for (const line of lines) {
    const v = VERSION_HEADING.exec(line);
    if (v) {
      flushBullet();
      section = null;
      current = { version: v[1].trim(), date: v[2]?.trim() ?? null, sections: [] };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const s = SECTION_HEADING.exec(line);
    if (s) {
      flushBullet();
      section = { kind: s[1].trim(), bullets: [] };
      current.sections.push(section);
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      flushBullet();
      bulletBuf = [b[1]];
      continue;
    }
    // Continuation of a multi-line bullet (indented or wrapped).
    if (bulletBuf.length > 0 && line.trim().length > 0) {
      bulletBuf.push(line.trim());
    }
  }
  flushBullet();
  return entries;
}

let _cached: ChangelogEntry[] | null = null;
export function loadChangelog(): ChangelogEntry[] {
  if (_cached) return _cached;
  _cached = parseChangelog(RAW_CHANGELOG);
  return _cached;
}

export function latestVersion(entries: ChangelogEntry[]): string | null {
  return entries[0]?.version ?? null;
}
