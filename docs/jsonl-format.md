# Claude Code JSONL transcript format

> **Unofficial, reverse-engineered.** This is the shape Claude Code writes to
> `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. It is not documented
> by Anthropic and may change between Claude Code versions. The parser in
> `@claude-sessions/parser` is defensive against missing fields.

## File layout

```
~/.claude/projects/
  -Users-me-Repo-agentfleet/               ← encoded cwd (slashes → dashes)
    0a1b2c3d-4e5f-6789-abcd-ef0123456789.jsonl    ← one file per session
    ...
```

Each JSONL line is an independent JSON object with a `type` field. Lines are
*roughly* chronological, but attachments can be flushed after their triggering
events with earlier timestamps.

## Top-level line types

| `type` | Description |
| --- | --- |
| `user` | A user message or tool_result returned to the agent |
| `assistant` | One content block from an assistant message |
| `attachment` | Metadata attachment (hook_success, skill_listing, mcp_instructions_delta, etc.) — not conversational |
| `queue-operation` | Internal queuing metadata |
| `last-prompt` | Internal bookkeeping |

## Common fields

Every line typically carries:

```ts
{
  type: string;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;       // ISO 8601
  sessionId: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;        // Claude Code version
}
```

## `assistant` lines

```ts
{
  type: "assistant",
  uuid, parentUuid, timestamp, sessionId, cwd, gitBranch,
  requestId?: string,
  message: {
    id: string,            // msg_xxx — same across all blocks in one API response
    role: "assistant",
    model: string,         // e.g. "claude-opus-4-6"
    content: [             // usually ONE block per line
      | { type: "text", text: string }
      | { type: "thinking", thinking: string }
      | { type: "tool_use", id: string, name: string, input: unknown }
    ],
    usage: {
      input_tokens: number,
      output_tokens: number,
      cache_read_input_tokens: number,
      cache_creation_input_tokens: number
    },
    stop_reason: string
  }
}
```

### ⚠️ Usage dedup

Claude Code splits one API response into multiple JSONL lines — one per
content block. All lines carry **identical** `usage` with the same `message.id`.

If you sum `usage` across all lines, you'll count every API response N times
(where N is the number of content blocks in that response).

**Fix:** sum usage *once per unique `message.id`*. The parser does this in
[`parser.ts`](../packages/parser/src/parser.ts).

## `user` lines

Two shapes: a bare string, or a content-block array containing either text or
`tool_result` blocks (responses to preceding assistant tool calls).

```ts
// Shape 1 — text message
{
  type: "user",
  message: {
    role: "user",
    content: "Hello"
  }
}

// Shape 2 — tool result
{
  type: "user",
  message: {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "toolu_xxx", content: "..." }
    ]
  },
  toolUseResult?: unknown    // mirrored at the top level
}
```

### Special user injections

Claude Code injects a few synthetic user blocks that aren't "real" user messages:

- **Skill contents** — a text block starting with `"Base directory for this skill:"`. Hide from transcripts.
- **Slash commands** — an XML-ish blob:
  ```
  <command-name>/implement</command-name>
  <command-args>AGE-9</command-args>
  ```
- **Task notifications** — background-task completion events:
  ```
  <task-notification>
    <status>completed</status>
    <summary>Build passed</summary>
    <task-id>...</task-id>
    <tool-use-id>...</tool-use-id>
    <output-file>...</output-file>
  </task-notification>
  ```

## `attachment` lines

```ts
{
  type: "attachment",
  attachment: {
    type: "hook_success" | "skill_listing" | "deferred_tools_delta" | "mcp_instructions_delta" | ...,
    content?: string | object,
    addedNames?: string[]
  }
}
```

These are bookkeeping, not conversation. They're valuable for debugging tool
discovery, but hidden from the "meaningful actions" presentation stream.

## Timing

`timestamp` is ISO 8601. Two gotchas:

1. **JSONL is not strictly chronological.** Attachments can appear with earlier
   timestamps than the events that triggered them. Compute session bounds as
   `min(all timestamps)` → `max(all timestamps)`, not first/last line.
2. **Gaps between events** should only be measured against the previous
   *conversational* event (user / assistant / tool_call / tool_result), not
   meta or attachment lines.

See `parseTranscript` for the full handling.

## Links

- Parser implementation: [`packages/parser/src/parser.ts`](../packages/parser/src/parser.ts)
- Presentation layer: [`packages/parser/src/presentation.ts`](../packages/parser/src/presentation.ts)
- Analytics helpers: [`packages/parser/src/analytics.ts`](../packages/parser/src/analytics.ts)
- Anthropic's [prompt caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — for context on the `cache_read` / `cache_write` split
