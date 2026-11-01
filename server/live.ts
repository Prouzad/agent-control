import { obj, str } from '@/lib/json'

import { db } from './db'
import { eventsSince, recentEvents, type HookEvent } from './hooks'
import { type View } from './visibility'

const WINDOW_MS = 3 * 60 * 60 * 1000
const STALE_MS = 10 * 60 * 1000
const TRANSCRIPT_ACTIVE_MS = 15 * 60 * 1000
// Without hooks, a transcript quiet for this long no longer reads as working
const TRANSCRIPT_QUIET_MS = 2 * 60 * 1000

export type LiveStatus = 'working' | 'waiting' | 'idle' | 'stale' | 'ended'

export type ToolActivity = { name: string; summary: string | null; since: string }

export type LiveAgent = {
  agentId: string
  agentType: string | null
  since: string
  tool: ToolActivity | null
}

export type LiveSession = {
  sessionId: string
  // Set when the dashboard started this session for a task with a role
  roleId: string | null
  teamId: string | null
  // Set when the dashboard started this session: where to see and steer it
  taskId: string | null
  pipelineId: string | null
  stageId: string | null
  stageLabel: string | null
  title: string | null
  cwd: string | null
  projectName: string | null
  status: LiveStatus
  note: string | null
  lastEventAt: string
  lastPrompt: string | null
  tool: ToolActivity | null
  agents: LiveAgent[]
  toolCalls: number
  costUsd: number
  // 'hooks' when driven by live events, 'transcript' when inferred from transcript writes only
  source: 'hooks' | 'transcript'
}

export type LiveSnapshot = {
  sessions: LiveSession[]
  feed: HookEvent[]
  // Session titles for feed lines, including sessions that are no longer active
  titles: Record<string, string>
  hooksSeen: boolean
  at: string
}

type Draft = Omit<
  LiveSession,
  | 'title'
  | 'projectName'
  | 'toolCalls'
  | 'costUsd'
  | 'agents'
  | 'roleId'
  | 'teamId'
  | 'taskId'
  | 'pipelineId'
  | 'stageId'
  | 'stageLabel'
> & {
  agents: Map<string, LiveAgent>
}

const fold = (draft: Draft, e: HookEvent) => {
  draft.lastEventAt = e.ts
  draft.cwd ??= e.cwd
  const tool = e.toolName ? { name: e.toolName, summary: e.summary, since: e.ts } : null
  const agent = e.agentId ? draft.agents.get(e.agentId) : undefined
  switch (e.event) {
    case 'SessionStart':
      draft.status = 'idle'
      break
    case 'UserPromptSubmit':
      draft.status = 'working'
      draft.lastPrompt = e.summary
      draft.note = null
      break
    case 'PreToolUse':
      if (e.agentId) {
        if (agent) agent.tool = tool
      } else {
        draft.tool = tool
        draft.status = 'working'
        draft.note = null
      }
      break
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (agent) agent.tool = null
      else if (!e.agentId) draft.tool = null
      break
    case 'PermissionRequest':
      draft.status = 'waiting'
      draft.note = `Нужно разрешение: ${e.toolName ?? 'инструмент'}`
      break
    case 'Notification':
      draft.status = 'waiting'
      draft.note = e.summary
      break
    case 'SubagentStart':
      if (e.agentId) {
        draft.agents.set(e.agentId, {
          agentId: e.agentId,
          agentType: e.agentType,
          since: e.ts,
          tool: null,
        })
      }
      break
    case 'SubagentStop':
      if (e.agentId) draft.agents.delete(e.agentId)
      break
    case 'Stop':
    case 'StopFailure':
      draft.status = draft.agents.size ? 'working' : 'idle'
      draft.tool = null
      draft.note = e.event === 'StopFailure' ? 'Ход завершился ошибкой' : null
      break
    case 'SessionEnd':
      draft.status = 'ended'
      draft.tool = null
      draft.agents.clear()
      break
  }
}

const sessionInfo = (sessionId: string) => {
  const r = obj(
    db()
      .prepare(
        `SELECT s.title, s.first_prompt, s.cwd, s.project_id, p.name AS project_name,
           (SELECT t.role_id FROM tasks t WHERE t.session_id = s.id LIMIT 1) AS role_id,
           (SELECT r.team_id FROM tasks t JOIN roles r ON r.id = t.role_id WHERE t.session_id = s.id LIMIT 1) AS team_id,
           (SELECT COUNT(*) FROM tool_calls WHERE session_id = s.id) AS tools,
           (SELECT COALESCE(SUM(cost_usd), 0) FROM messages WHERE session_id = s.id) AS cost
         FROM sessions s LEFT JOIN projects p ON p.id = s.project_id WHERE s.id = ?`,
      )
      .get(sessionId),
  )
  // Asked apart from the session row, which the indexer may not have written yet for a fresh run
  const t = obj(
    db()
      .prepare(
        `SELECT t.id, t.title, t.pipeline_id, t.stage_id, st.label AS stage_label
         FROM tasks t LEFT JOIN pipeline_stages st ON st.id = t.stage_id
         WHERE t.session_id = ? ORDER BY t.created_at DESC LIMIT 1`,
      )
      .get(sessionId),
  )
  return {
    taskId: str(t?.['id']) ?? null,
    pipelineId: str(t?.['pipeline_id']) ?? null,
    stageId: str(t?.['stage_id']) ?? null,
    stageLabel: str(t?.['stage_label']) ?? null,
    title: str(r?.['title']) ?? str(r?.['first_prompt'])?.slice(0, 80) ?? str(t?.['title']) ?? null,
    cwd: str(r?.['cwd']) ?? null,
    projectId: str(r?.['project_id']) ?? null,
    projectName: str(r?.['project_name']) ?? null,
    roleId: str(r?.['role_id']) ?? null,
    teamId: str(r?.['team_id']) ?? null,
    toolCalls: Number(r?.['tools'] ?? 0),
    costUsd: Number(r?.['cost'] ?? 0),
  }
}

// Sessions without hook events, but whose transcript was written to recently
const transcriptOnly = (known: Set<string>): LiveSession[] => {
  const since = new Date(Date.now() - TRANSCRIPT_ACTIVE_MS).toISOString()
  return db()
    .prepare('SELECT id, ended_at FROM sessions WHERE ended_at >= ? ORDER BY ended_at DESC')
    .all(since)
    .flatMap((row) => {
      const r = obj(row)
      const sessionId = str(r?.['id'])
      const endedAt = str(r?.['ended_at'])
      if (!sessionId || !endedAt || known.has(sessionId)) return []
      const last = obj(
        db()
          .prepare(
            'SELECT name, summary, ts FROM tool_calls WHERE session_id = ? ORDER BY ts DESC LIMIT 1',
          )
          .get(sessionId),
      )
      const name = str(last?.['name'])
      const info = sessionInfo(sessionId)
      return [
        {
          sessionId,
          ...info,
          status: (Date.now() - new Date(endedAt).getTime() > TRANSCRIPT_QUIET_MS
            ? 'stale'
            : 'working') satisfies LiveStatus,
          note: null,
          lastEventAt: endedAt,
          lastPrompt: null,
          tool: name
            ? { name, summary: str(last?.['summary']) ?? null, since: str(last?.['ts']) ?? endedAt }
            : null,
          agents: [],
          source: 'transcript' as const,
        },
      ]
    })
}

const STATUS_ORDER: Record<LiveStatus, number> = {
  waiting: 0,
  working: 1,
  stale: 2,
  idle: 3,
  ended: 4,
}

// Sessions of hidden projects, or outside the chosen workspace, are left out entirely
export const liveSnapshot = (view: View): LiveSnapshot => {
  const since = new Date(Date.now() - WINDOW_MS).toISOString()
  const drafts = new Map<string, Draft>()
  for (const e of eventsSince(since)) {
    const draft =
      drafts.get(e.sessionId) ??
      ({
        sessionId: e.sessionId,
        cwd: null,
        status: 'idle',
        note: null,
        lastEventAt: e.ts,
        lastPrompt: null,
        tool: null,
        agents: new Map(),
        source: 'hooks',
      } satisfies Draft)
    fold(draft, e)
    drafts.set(e.sessionId, draft)
  }

  const now = Date.now()
  const fromHooks = [...drafts.values()]
    .filter((d) => d.status !== 'ended')
    .map((d): LiveSession => {
      const info = sessionInfo(d.sessionId)
      const quiet = now - new Date(d.lastEventAt).getTime() > STALE_MS
      return {
        ...d,
        ...info,
        cwd: d.cwd ?? info.cwd,
        status: d.status === 'working' && quiet ? 'stale' : d.status,
        agents: [...d.agents.values()],
      }
    })

  const allowed = new Map<string, boolean>()
  const visible = (sessionId: string, cwd: string | null) => {
    const known = allowed.get(sessionId)
    if (known !== undefined) return known
    const info = sessionInfo(sessionId)
    const ok = view.allowsSession(info.projectId, info.cwd ?? cwd)
    allowed.set(sessionId, ok)
    return ok
  }
  const sessions = [...fromHooks, ...transcriptOnly(new Set(drafts.keys()))]
    .filter((s) => visible(s.sessionId, s.cwd))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.lastEventAt.localeCompare(a.lastEventAt),
    )
  // Successful PostToolUse repeats its PreToolUse line, so the feed skips it
  const feed = recentEvents(120)
    .filter((e) => e.event !== 'PostToolUse' && visible(e.sessionId, e.cwd))
    .slice(0, 80)

  const titles: Record<string, string> = {}
  for (const id of new Set(feed.map((e) => e.sessionId))) {
    const title = sessionInfo(id).title
    if (title) titles[id] = title
  }

  return {
    sessions,
    feed,
    titles,
    hooksSeen: drafts.size > 0 || feed.length > 0,
    at: new Date().toISOString(),
  }
}
