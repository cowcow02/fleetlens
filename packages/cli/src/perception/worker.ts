import { statSync } from "node:fs";
import { buildEntries } from "@claude-lens/entries";
import { agentSources, MAX_JSONL_FILE_BYTES } from "@claude-lens/parser/fs";
import type { AgentSource } from "@claude-lens/parser/fs";
import { writeEntryPreservingEnrichment } from "@claude-lens/entries/fs";
import {
  readState, updateCheckpoint, markSweepStart, markSweepEnd, isSweepStale,
  type FileCheckpoint,
} from "./state.js";
import { listAllSessionJsonls } from "./scan.js";
import { buildEntriesForFileAsync } from "./build-entries.js";

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.error(`[perception] ${msg}`);
}

export type SweepResult = {
  sessionsProcessed: number;
  entriesWritten: number;
  errors: number;
  skippedOversized: number;
};

export type SweepOptions = {
  /** Override ~/.claude/projects for testing. */
  projectsRoot?: string;
  /** Override the 64 MiB parse cap (tests). */
  maxFileBytes?: number;
  /** Override the non-Claude source pass. Default: all agentSources except
   *  claude-code, skipped when projectsRoot is set so tests don't touch
   *  real ~/.codex data. */
  extraSources?: AgentSource[];
};

function checkpoint(path: string, statSize: number, extra?: Partial<FileCheckpoint>): void {
  updateCheckpoint(path, {
    byte_offset: statSize,
    last_event_ts: extra?.last_event_ts ?? null,
    affects_days: extra?.affects_days ?? [],
  });
}

export async function runPerceptionSweep(opts: SweepOptions = {}): Promise<SweepResult> {
  const state = readState();
  if (state.sweep_in_progress && !isSweepStale()) {
    return { sessionsProcessed: 0, entriesWritten: 0, errors: 0, skippedOversized: 0 };
  }
  markSweepStart();

  const maxFileBytes = opts.maxFileBytes ?? MAX_JSONL_FILE_BYTES;
  let sessions = 0;
  let entries = 0;
  let errors = 0;
  let skippedOversized = 0;

  try {
    const files = await listAllSessionJsonls(opts.projectsRoot);
    for (const f of files) {
      try {
        const stat = statSync(f);
        const prev = state.file_checkpoints[f];
        if (prev && prev.byte_offset >= stat.size) continue;

        if (stat.size > maxFileBytes) {
          checkpoint(f, stat.size);
          state.file_checkpoints[f] = { byte_offset: stat.size, last_event_ts: null, affects_days: [] };
          skippedOversized++;
          log(`skipped oversized ${f} (${stat.size} bytes)`);
          continue;
        }

        // Reconstruct + build entries via the shared claude-code helper so the
        // team-sync ensure-entries path produces byte-identical (session, day)
        // keys (see build-entries.ts).
        const built = await buildEntriesForFileAsync(f);
        // null = blank/unreadable → nothing parsed, don't checkpoint. []
        // = parsed with zero entries → checkpoint below so this file isn't
        // re-parsed every 5-min sweep (418 such transcripts on a real machine).
        if (built === null) continue;

        for (const e of built) {
          // Preserve any committed enrichment on disk — `buildEntries` always
          // emits status="pending", but a prior sweep may have already paid
          // the LLM cost to enrich this exact (session, local_day) tuple.
          writeEntryPreservingEnrichment(e);
          entries++;
        }
        checkpoint(f, stat.size, {
          last_event_ts: built.at(-1)?.end_iso ?? null,
          affects_days: built.map(e => e.local_day),
        });
        state.file_checkpoints[f] = {
          byte_offset: stat.size,
          last_event_ts: built.at(-1)?.end_iso ?? null,
          affects_days: built.map(e => e.local_day),
        };
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
    const extraSources = opts.extraSources ?? (
      opts.projectsRoot === undefined
        ? agentSources.filter((s) => s.kind !== "claude-code")
        : []
    );
    for (const source of extraSources) {
      if (source.kind === "claude-code") continue;
      try {
        const metas = await source.listSessions();
        for (const meta of metas) {
          try {
            if (!meta.filePath) continue;
            let stat;
            try {
              stat = statSync(meta.filePath);
            } catch {
              continue;
            }
            const prev = state.file_checkpoints[meta.filePath];
            if (prev && prev.byte_offset >= stat.size) continue;

            if (stat.size > maxFileBytes) {
              checkpoint(meta.filePath, stat.size);
              state.file_checkpoints[meta.filePath] = {
                byte_offset: stat.size,
                last_event_ts: null,
                affects_days: [],
              };
              skippedOversized++;
              log(`skipped oversized ${source.kind} ${meta.filePath} (${stat.size} bytes)`);
              continue;
            }

            const detail = await source.getSession(meta.id);
            if (!detail) {
              checkpoint(meta.filePath, stat.size);
              state.file_checkpoints[meta.filePath] = {
                byte_offset: stat.size,
                last_event_ts: null,
                affects_days: [],
              };
              continue;
            }
            const built = buildEntries(detail);
            for (const e of built) {
              e.source_checkpoint.byte_offset = stat.size;
              writeEntryPreservingEnrichment(e);
              entries++;
            }
            checkpoint(meta.filePath, stat.size, {
              last_event_ts: built.at(-1)?.end_iso ?? null,
              affects_days: built.map((e) => e.local_day),
            });
            state.file_checkpoints[meta.filePath] = {
              byte_offset: stat.size,
              last_event_ts: built.at(-1)?.end_iso ?? null,
              affects_days: built.map((e) => e.local_day),
            };
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
  } finally {
    markSweepEnd();
  }

  return { sessionsProcessed: sessions, entriesWritten: entries, errors, skippedOversized };
}
