import { obj, str, type Json } from '@/lib/json'

import { bus } from './bus'
import { db } from './db'
import { indexNow } from './indexer'

const RETENTION_DAYS = 14
const REINDEX_DEBOUNCE_MS = 2_000

export type HookEvent = {
  id: number
  ts: string
  sessionId: string
  event: string
  cwd: string | null
  agentId: string | null
  agentType: string | null
  toolName: string | null
  toolUseId: string | null
  summary: string | null
}

declare global {
  var agentControlReindexTimer: NodeJS.Timeout | undefined
  var agentControlLastPrune: number | undefined
}

const clip = (value: string | undefined, max = 200) =>
  value ? value.replace(/\s+/g, ' ').trim().slice(0, max) || null : null

// One readable line per event; field names follow the Claude Code hooks reference
const summarize = (payload: Json): string | null => {
  const input = obj(payload['tool_input'])
  switch (payload['hook_event_name']) {
    case 'UserPromptSubmit':
      return clip(str(payload['prompt']))
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest':
      return clip(
        str(input?.['description']) ??
          str(input?.['command']) ??
          str(input?.['file_path']) ??
          str(input?.['pattern']) ??
          str(input?.['url']) ??
          str(input?.['prompt']) ??
          str(payload['error']),
      )
    case 'Notification':
      return clip(str(payload['message']))
    case 'Stop':
    case 'SubagentStop':
      return clip(str(payload['last_assistant_message']))
    case 'SessionStart':
    case 'SessionEnd':
      return clip(str(payload['source']) ?? str(payload['reason']))
    case 'TaskCreated':
    case 'TaskCompleted':
      return clip(str(payload['task_subject']) ?? str(payload['subject']))
    default:
      return null
  }
}

const insert = () =>
  db().prepare(`
    INSERT INTO hook_events (ts, session_id, event, cwd, agent_id, agent_type, tool_name, tool_use_id, summary)
    VALUES (@ts, @sessionId, @event, @cwd, @agentId, @agentType, @toolName, @toolUseId, @summary)
  `)

const prune = () => {
  const day = 24 * 60 * 60 * 1000
  if (Date.now() - (globalThis.agentControlLastPrune ?? 0) < day) return
  globalThis.agentControlLastPrune = Date.now()
  const cutoff = new Date(Date.now() - RETENTION_DAYS * day).toISOString()
  db().prepare('DELETE FROM hook_events WHERE ts < ?').run(cutoff)
}

// Transcript stats lag the hook stream; one re-index shortly after a burst catches them up
const scheduleReindex = () => {
  clearTimeout(globalThis.agentControlReindexTimer)
  globalThis.agentControlReindexTimer = setTimeout(() => void indexNow(), REINDEX_DEBOUNCE_MS)
}

export const recordHook = (payload: Json): HookEvent | undefined => {
  const sessionId = str(payload['session_id'])
  const event = str(payload['hook_event_name'])
  if (!sessionId || !event) return undefined
  const row = {
    ts: new Date().toISOString(),
    sessionId,
    event,
    cwd: str(payload['cwd']) ?? null,
    agentId: str(payload['agent_id']) ?? null,
    agentType: str(payload['agent_type']) ?? null,
    toolName: str(payload['tool_name']) ?? null,
    toolUseId: str(payload['tool_use_id']) ?? null,
    summary: summarize(payload),
  }
  const { lastInsertRowid } = insert().run(row)
  const recorded: HookEvent = { id: Number(lastInsertRowid), ...row }
  bus().emit('hook', recorded)
  scheduleReindex()
  prune()
  return recorded
}

const toEvent = (row: unknown): HookEvent | undefined => {
  const r = obj(row)
  const sessionId = str(r?.['session_id'])
  const event = str(r?.['event'])
  const ts = str(r?.['ts'])
  if (!r || !sessionId || !event || !ts) return undefined
  return {
    id: Number(r['id']),
    ts,
    sessionId,
    event,
    cwd: str(r['cwd']) ?? null,
    agentId: str(r['agent_id']) ?? null,
    agentType: str(r['agent_type']) ?? null,
    toolName: str(r['tool_name']) ?? null,
    toolUseId: str(r['tool_use_id']) ?? null,
    summary: str(r['summary']) ?? null,
  }
}

export const recentEvents = (limit = 80): HookEvent[] =>
  db()
    .prepare('SELECT * FROM hook_events ORDER BY id DESC LIMIT ?')
    .all(limit)
    .flatMap((row) => toEvent(row) ?? [])

export const eventsSince = (since: string): HookEvent[] =>
  db()
    .prepare('SELECT * FROM hook_events WHERE ts >= ? ORDER BY id')
    .all(since)
    .flatMap((row) => toEvent(row) ?? [])

export const hasAnyHookEvents = () =>
  db().prepare('SELECT 1 FROM hook_events LIMIT 1').get() !== undefined
