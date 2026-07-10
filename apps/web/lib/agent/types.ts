export const INDEX_VERSION = 2;

export type IndexChunk = {
  role: "user" | "agent" | "summary";
  text: string;
  /** event index in the source transcript, when applicable */
  idx?: number;
};

/** One searchable session — extracted conversational text plus metadata. */
export type IndexDoc = {
  version: number;
  sessionId: string;
  agent: string;
  /** canonical project name (worktrees rolled up) */
  project: string;
  /** GitHub repo name from the origin remote — the display name the rest of
   *  the UI uses when the folder is named something else. */
  repoName?: string;
  /** local day of session start, YYYY-MM-DD */
  day: string;
  startIso?: string;
  endIso?: string;
  title: string;
  chunks: IndexChunk[];
  truncated?: boolean;
  mtimeMs: number;
  sizeBytes: number;
};

export type SearchFilters = {
  project?: string;
  agent?: string;
  /** inclusive YYYY-MM-DD bounds on the session's start day */
  after?: string;
  before?: string;
};

export type SearchSnippet = { role: string; text: string };

export type SearchHit = {
  sessionId: string;
  agent: string;
  project: string;
  day: string;
  title: string;
  score: number;
  matchedTerms: string[];
  snippets: SearchSnippet[];
};
