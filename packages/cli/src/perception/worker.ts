import { statSync } from "node:fs";
import { buildEntries } from "@claude-lens/entries";
import { agentSources } from "@claude-lens/parser/fs";
import { writeEntryPreservingEnrichment } from "@claude-lens/entries/fs";
import {
  readState, updateCheckpoint, markSweepStart, markSweepEnd, isSweepStale,
} from "./state.js";
import { listAllSessionJsonls } from "./scan.js";
import { buildEntriesForFile } from "./build-entries.js";

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(`[perception] ${msg}`);
}

export type SweepResult = {
  sessionsProcessed: number;
  entriesWritten: number;
  errors: number;
};

export type SweepOptions = {
  /** Override ~/.claude/projects for testing. */
  projectsRoot?: string;
};

export async function runPerceptionSweep(opts: SweepOptions = {}): Promise<SweepResult> {
  const state = readState();
  if (state.sweep_in_progress && !isSweepStale()) {
    return { sessionsProcessed: 0, entriesWritten: 0, errors: 0 };
  }
  markSweepStart();

  let sessions = 0;
  let entries = 0;
  let errors = 0;

  try {
    const files = await listAllSessionJsonls(opts.projectsRoot);
    for (const f of files) {
      try {
        const stat = statSync(f);
        const prev = state.file_checkpoints[f];
        if (prev && prev.byte_offset >= stat.size) continue;

        // Reconstruct + build entries via the shared claude-code helper so the
        // team-sync ensure-entries path produces byte-identical (session, day)
        // keys (see build-entries.ts).
        const built = buildEntriesForFile(f);
        if (built.length === 0) continue;

        for (const e of built) {
          // Preserve any committed enrichment on disk — `buildEntries` always
          // emits status="pending", but a prior sweep may have already paid
          // the LLM cost to enrich this exact (session, local_day) tuple.
          writeEntryPreservingEnrichment(e);
          entries++;
        }
        updateCheckpoint(f, {
          byte_offset: stat.size,
          last_event_ts: built.at(-1)?.end_iso ?? null,
          affects_days: built.map(e => e.local_day),
        });
        sessions++;
      } catch (err) {
        errors++;
        log(`skipped ${f}: ${(err as Error).message}`);
      }
    }
    // Daemon no longer auto-enriches: LLM spend is gated on an explicit
    // user request (home page auto-fires yesterday, or Generate on a past
    // day) so first-run users don't get a surprise bill from a backfill.

    // Non-Claude sources read from their own default roots, which would
    // pull in real ~/.codex data when tests pin projectsRoot to a tmp dir.
    if (opts.projectsRoot === undefined) {
      for (const source of agentSources) {
        if (source.kind === "claude-code") continue;
        try {
          const metas = await source.listSessions();
          for (const meta of metas) {
            try {
              const detail = await source.getSession(meta.id);
              if (!detail) continue;
              const built = buildEntries(detail);
              for (const e of built) {
                try {
                  const stat = statSync(meta.filePath);
                  e.source_checkpoint.byte_offset = stat.size;
                } catch {
                  // file disappeared between list + build — fall through with 0
                }
                writeEntryPreservingEnrichment(e);
                entries++;
              }
              sessions++;
            } catch (err) {
              errors++;
              log(`${source.kind} skipped ${meta.id}: ${(err as Error).message}`);
            }
          }
        } catch (err) {
          log(`${source.kind} pass failed: ${(err as Error).message}`);
        }
      }
    }
  } finally {
    markSweepEnd();
  }

  return { sessionsProcessed: sessions, entriesWritten: entries, errors };
}
