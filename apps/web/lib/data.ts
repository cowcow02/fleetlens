/**
 * Server-only data access layer.
 *
 * Wraps @claude-lens/parser/fs with a per-request cache so a single RSC
 * render doesn't re-scan the agent disk roots for every page that needs
 * the session list. Multi-agent: iterates the parser's AgentSource
 * registry, so adding a new agent means adding one source — no edits here.
 */

import "server-only";
import { cache } from "react";
import { listAllSessions, getAnySession } from "@claude-lens/parser/fs";

export const listSessions = cache(async () => {
  return listAllSessions({ limit: 1000 });
});

export const getSession = cache(async (id: string) => {
  return getAnySession(id);
});
