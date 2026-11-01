import { obj, num, str } from '@/lib/json'

import { db } from './db'

export type Scope = {
  since: string | null
  // Project ids including descendants; null means every project
  projectIds: string[] | null
  // Hidden projects, left out even when projectIds is null
  excludeIds?: string[]
}

// Builds the shared filter over messages/tool_calls (alias x) joined to sessions (alias s)
const where = (scope: Scope, tsColumn: string) => {
  const clauses: string[] = []
  const params: Record<string, string> = {}
  if (scope.since) {
    clauses.push(`${tsColumn} >= @since`)
    params['since'] = scope.since
  }
  if (scope.projectIds) {
    const names = scope.projectIds.map((id, i) => {
      params[`p${i}`] = id
      return `@p${i}`
    })
    clauses.push(names.length ? `s.project_id IN (${names.join(', ')})` : '0')
  }
  if (scope.excludeIds?.length) {
    const names = scope.excludeIds.map((id, i) => {
      params[`h${i}`] = id
      return `@h${i}`
    })
    clauses.push(`(s.project_id IS NULL OR s.project_id NOT IN (${names.join(', ')}))`)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

const rows = (sql: string, params: Record<string, string>) =>
  db()
    .prepare(sql)
    .all(params)
    .flatMap((row) => {
      const r = obj(row)
      return r ? [r] : []
    })

export type Totals = {
  sessions: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  toolCalls: number
  toolErrors: number
  subagents: number
}

export const totals = (scope: Scope): Totals => {
  const m = where(scope, 'x.ts')
  const tokens = rows(
    `SELECT COUNT(DISTINCT x.session_id) AS sessions, SUM(x.cost_usd) AS cost,
       SUM(x.input_tokens) AS input, SUM(x.output_tokens) AS output,
       SUM(x.cache_read_tokens) AS cache_read,
       SUM(x.cache_write_5m_tokens + x.cache_write_1h_tokens) AS cache_write,
       COUNT(DISTINCT x.agent_id) AS subagents
     FROM messages x JOIN sessions s ON s.id = x.session_id ${m.sql}`,
    m.params,
  )[0]
  const t = where(scope, 'x.ts')
  const tools = rows(
    `SELECT COUNT(*) AS calls, SUM(CASE WHEN x.is_error = 1 THEN 1 ELSE 0 END) AS errors
     FROM tool_calls x JOIN sessions s ON s.id = x.session_id ${t.sql}`,
    t.params,
  )[0]
  return {
    sessions: num(tokens?.['sessions']),
    costUsd: num(tokens?.['cost']),
    inputTokens: num(tokens?.['input']),
    outputTokens: num(tokens?.['output']),
    cacheReadTokens: num(tokens?.['cache_read']),
    cacheWriteTokens: num(tokens?.['cache_write']),
    subagents: num(tokens?.['subagents']),
    toolCalls: num(tools?.['calls']),
    toolErrors: num(tools?.['errors']),
  }
}

export type DailyModelCost = { day: string; model: string; costUsd: number; outputTokens: number }

// Days are bucketed in local time so "today" matches the user's calendar
export const dailyByModel = (scope: Scope): DailyModelCost[] => {
  const m = where(scope, 'x.ts')
  return rows(
    `SELECT date(x.ts, 'localtime') AS day, x.model AS model, SUM(x.cost_usd) AS cost,
       SUM(x.output_tokens) AS output
     FROM messages x JOIN sessions s ON s.id = x.session_id ${m.sql}
     GROUP BY day, x.model ORDER BY day`,
    m.params,
  ).map((r) => ({
    day: str(r['day']) ?? '',
    model: str(r['model']) ?? '',
    costUsd: num(r['cost']),
    outputTokens: num(r['output']),
  }))
}

export type ModelUsage = {
  model: string
  messages: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export const byModel = (scope: Scope): ModelUsage[] => {
  const m = where(scope, 'x.ts')
  return rows(
    `SELECT x.model AS model, COUNT(*) AS messages, SUM(x.cost_usd) AS cost,
       SUM(x.input_tokens) AS input, SUM(x.output_tokens) AS output,
       SUM(x.cache_read_tokens) AS cache_read,
       SUM(x.cache_write_5m_tokens + x.cache_write_1h_tokens) AS cache_write
     FROM messages x JOIN sessions s ON s.id = x.session_id ${m.sql}
     GROUP BY x.model ORDER BY cost DESC`,
    m.params,
  ).map((r) => ({
    model: str(r['model']) ?? '',
    messages: num(r['messages']),
    costUsd: num(r['cost']),
    inputTokens: num(r['input']),
    outputTokens: num(r['output']),
    cacheReadTokens: num(r['cache_read']),
    cacheWriteTokens: num(r['cache_write']),
  }))
}

export type ProjectUsage = { projectId: string | null; sessions: number; costUsd: number }

export const byProject = (scope: Scope): ProjectUsage[] => {
  const m = where(scope, 'x.ts')
  return rows(
    `SELECT s.project_id AS project_id, COUNT(DISTINCT x.session_id) AS sessions,
       SUM(x.cost_usd) AS cost
     FROM messages x JOIN sessions s ON s.id = x.session_id ${m.sql}
     GROUP BY s.project_id ORDER BY cost DESC`,
    m.params,
  ).map((r) => ({
    projectId: str(r['project_id']) ?? null,
    sessions: num(r['sessions']),
    costUsd: num(r['cost']),
  }))
}

export type ToolUsage = { name: string; calls: number; errors: number }

export const topTools = (scope: Scope, limit = 12): ToolUsage[] => {
  const t = where(scope, 'x.ts')
  return rows(
    `SELECT x.name AS name, COUNT(*) AS calls,
       SUM(CASE WHEN x.is_error = 1 THEN 1 ELSE 0 END) AS errors
     FROM tool_calls x JOIN sessions s ON s.id = x.session_id ${t.sql}
     GROUP BY x.name ORDER BY calls DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
    t.params,
  ).map((r) => ({ name: str(r['name']) ?? '', calls: num(r['calls']), errors: num(r['errors']) }))
}

export type SubagentUsage = { agentType: string; runs: number; costUsd: number }

export const bySubagentType = (scope: Scope): SubagentUsage[] => {
  const m = where(scope, 'a.started_at')
  return rows(
    `SELECT COALESCE(a.agent_type, 'unknown') AS agent_type, COUNT(DISTINCT a.id) AS runs,
       COALESCE(SUM(x.cost_usd), 0) AS cost
     FROM subagents a JOIN sessions s ON s.id = a.session_id
     LEFT JOIN messages x ON x.agent_id = a.id ${m.sql}
     GROUP BY agent_type ORDER BY cost DESC`,
    m.params,
  ).map((r) => ({
    agentType: str(r['agent_type']) ?? 'unknown',
    runs: num(r['runs']),
    costUsd: num(r['cost']),
  }))
}

export type SessionRow = {
  id: string
  title: string | null
  firstPrompt: string | null
  cwd: string | null
  projectId: string | null
  gitBranch: string | null
  startedAt: string | null
  endedAt: string | null
  costUsd: number
  messages: number
  toolCalls: number
  subagents: number
  model: string | null
}

const SESSION_SELECT = `
  SELECT s.*,
    (SELECT COALESCE(SUM(cost_usd), 0) FROM messages WHERE session_id = s.id) AS cost,
    (SELECT COUNT(*) FROM messages WHERE session_id = s.id AND agent_id IS NULL) AS messages,
    (SELECT COUNT(*) FROM tool_calls WHERE session_id = s.id) AS tools,
    (SELECT COUNT(*) FROM subagents WHERE session_id = s.id) AS subagents,
    (SELECT model FROM messages WHERE session_id = s.id AND agent_id IS NULL
      GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1) AS main_model
  FROM sessions s`

const toSession = (r: Record<string, unknown>): SessionRow => ({
  id: str(r['id']) ?? '',
  title: str(r['title']) ?? null,
  firstPrompt: str(r['first_prompt']) ?? null,
  cwd: str(r['cwd']) ?? null,
  projectId: str(r['project_id']) ?? null,
  gitBranch: str(r['git_branch']) ?? null,
  startedAt: str(r['started_at']) ?? null,
  endedAt: str(r['ended_at']) ?? null,
  costUsd: num(r['cost']),
  messages: num(r['messages']),
  toolCalls: num(r['tools']),
  subagents: num(r['subagents']),
  model: str(r['main_model']) ?? null,
})

export const listSessions = (scope: Scope, limit = 200): SessionRow[] => {
  const w = where(scope, 's.ended_at')
  return rows(
    `${SESSION_SELECT} ${w.sql} ORDER BY s.ended_at DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
    w.params,
  ).map(toSession)
}

export const getSession = (id: string): SessionRow | undefined => {
  const row = rows(`${SESSION_SELECT} WHERE s.id = @id`, { id })[0]
  return row ? toSession(row) : undefined
}

export type ToolCall = {
  id: string
  ts: string
  name: string
  summary: string | null
  agentId: string | null
  isError: boolean | null
}

export const sessionToolCalls = (sessionId: string): ToolCall[] =>
  rows('SELECT * FROM tool_calls WHERE session_id = @id ORDER BY ts', { id: sessionId }).map(
    (r) => ({
      id: str(r['id']) ?? '',
      ts: str(r['ts']) ?? '',
      name: str(r['name']) ?? '',
      summary: str(r['summary']) ?? null,
      agentId: str(r['agent_id']) ?? null,
      isError: r['is_error'] === null || r['is_error'] === undefined ? null : r['is_error'] === 1,
    }),
  )

export type Subagent = {
  id: string
  agentType: string | null
  description: string | null
  startedAt: string | null
  costUsd: number
  toolCalls: number
}

export const sessionSubagents = (sessionId: string): Subagent[] =>
  rows(
    `SELECT a.*,
       (SELECT COALESCE(SUM(cost_usd), 0) FROM messages WHERE agent_id = a.id) AS cost,
       (SELECT COUNT(*) FROM tool_calls WHERE agent_id = a.id) AS tools
     FROM subagents a WHERE a.session_id = @id ORDER BY a.started_at`,
    { id: sessionId },
  ).map((r) => ({
    id: str(r['id']) ?? '',
    agentType: str(r['agent_type']) ?? null,
    description: str(r['description']) ?? null,
    startedAt: str(r['started_at']) ?? null,
    costUsd: num(r['cost']),
    toolCalls: num(r['tools']),
  }))

export const sessionByModel = (sessionId: string): ModelUsage[] =>
  rows(
    `SELECT model, COUNT(*) AS messages, SUM(cost_usd) AS cost, SUM(input_tokens) AS input,
       SUM(output_tokens) AS output, SUM(cache_read_tokens) AS cache_read,
       SUM(cache_write_5m_tokens + cache_write_1h_tokens) AS cache_write
     FROM messages WHERE session_id = @id GROUP BY model ORDER BY cost DESC`,
    { id: sessionId },
  ).map((r) => ({
    model: str(r['model']) ?? '',
    messages: num(r['messages']),
    costUsd: num(r['cost']),
    inputTokens: num(r['input']),
    outputTokens: num(r['output']),
    cacheReadTokens: num(r['cache_read']),
    cacheWriteTokens: num(r['cache_write']),
  }))

export type TokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  costUsd: number
}

export const EMPTY_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  costUsd: 0,
}

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  total: a.total + b.total,
  costUsd: a.costUsd + b.costUsd,
})

// Tokens of agent sessions, subagents included, as indexed from their transcripts
export const usageBySession = (sessionIds: string[]): Map<string, TokenUsage> => {
  const ids = [...new Set(sessionIds)]
  if (!ids.length) return new Map()
  const params = Object.fromEntries(ids.map((id, i) => [`s${i}`, id]))
  return new Map(
    rows(
      `SELECT session_id, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
         SUM(cache_read_tokens) AS cache_read,
         SUM(cache_write_5m_tokens + cache_write_1h_tokens) AS cache_write, SUM(cost_usd) AS cost
       FROM messages WHERE session_id IN (${ids.map((_, i) => `@s${i}`).join(', ')})
       GROUP BY session_id`,
      params,
    ).map((r) => {
      const input = num(r['input'])
      const output = num(r['output'])
      const cacheRead = num(r['cache_read'])
      const cacheWrite = num(r['cache_write'])
      return [
        str(r['session_id']) ?? '',
        {
          input,
          output,
          cacheRead,
          cacheWrite,
          total: input + output + cacheRead + cacheWrite,
          costUsd: num(r['cost']),
        },
      ]
    }),
  )
}
