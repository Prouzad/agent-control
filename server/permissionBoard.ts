import { query } from '@anthropic-ai/claude-agent-sdk'

import { obj, str } from '@/lib/json'

import { getRole, listRoles, type Role } from './org'
import { effectiveTeamIds } from './projects'
import type { Task } from './tasks'

// In auto mode a permission the agent could not take on its own goes to the project's architect
// and development lead before the person; a split or a doubt goes up to the CTO. What only a
// person may decide never reaches the board

const CTO_ROLE = 'cto'
const BOARD_MODEL = 'sonnet'
const BOARD_TIMEOUT_MS = 120_000
const CLIP = 2_500

export type BoardDecision = 'allow' | 'deny' | 'cto' | 'human'
export type BoardOutcome = { decision: 'allow' | 'deny' | 'human'; note: string }

const READ_ACTIONS = new Set(['read', 'list'])
const DANGEROUS_BASH =
  /\bgit\s+(push|merge|rebase|reset\s+--hard|branch\s+-D)|--force\b|\bnpm\s+publish\b|\brm\s+-rf\s+[/~]/
const PERSON_ONLY_TOOLS = new Set(['RemoteTrigger', 'CronCreate', 'Workflow', 'SendMessage'])

// Why this request is the person's alone, or null when the board may decide it
export const personOnlyReason = (toolName: string, input: unknown): string | null => {
  const i = obj(input)
  if (PERSON_ONLY_TOOLS.has(toolName)) return 'запускает работу вне этой сессии'
  if (toolName === 'Artifact' || toolName === 'ArtifactData' || toolName === 'ArtifactComments') {
    const action = str(i?.['action']) ?? 'publish'
    return READ_ACTIONS.has(action) || ['get', 'query'].includes(action)
      ? null
      : 'публикует или меняет то, что видят другие'
  }
  if (toolName === 'Bash' && DANGEROUS_BASH.test(str(i?.['command']) ?? ''))
    return 'push, merge, force или удаление вне рабочей папки'
  return null
}

// The roles that hold the architect and the development stages in the project's teams
const boardRoles = (projectId: string | null): Role[] => {
  if (!projectId) return []
  const teamIds = effectiveTeamIds(projectId)
  const roles = listRoles().filter((r) => teamIds.includes(r.teamId))
  const byStage = (key: string) => roles.find((r) => r.stages.includes(key))
  return [byStage('architect'), byStage('dev')].filter(
    (r, index, list): r is Role => Boolean(r) && list.indexOf(r) === index,
  )
}

const clip = (text: string) => (text.length > CLIP ? `${text.slice(0, CLIP)}…` : text)

const DECISION_LINE: Record<string, BoardDecision> = {
  РАЗРЕШИТЬ: 'allow',
  ЗАПРЕТИТЬ: 'deny',
  CTO: 'cto',
  ЧЕЛОВЕК: 'human',
}

const parseDecision = (text: string): BoardDecision => {
  const line =
    text
      .trim()
      .split('\n')
      .reverse()
      .find((l) => l.includes('РЕШЕНИЕ')) ?? ''
  const hit = Object.entries(DECISION_LINE).find(([word]) => line.includes(word))
  return hit?.[1] ?? 'human'
}

type Ask = {
  task: Task
  agentTitle: string
  toolName: string
  title: string | null
  input: unknown
  earlier?: string
}

const askOne = async (role: Role, ask: Ask, env: Record<string, string | undefined>) => {
  const prompt = [
    `Агент «${ask.agentTitle}» работает в авто-режиме и просит разрешение на действие. Решаешь ты, а не человек.`,
    `## Задача агента\n${ask.task.title}\n\n${clip(ask.task.description)}`,
    `## Действие\nИнструмент: ${ask.toolName}${ask.title ? `\nЧто просит: ${ask.title}` : ''}\nПараметры:\n${clip(JSON.stringify(ask.input, null, 2))}`,
    ask.earlier ? `## Мнения архитектора и лида\n${ask.earlier}` : null,
    [
      '## Как решать',
      'Разреши, если действие нужно для задачи и безопасно: чтение, проверки, правки в рабочей папке задачи, браузер на локальном сервере.',
      'Запрети, если оно не нужно задаче, рискованно или нарушает правила проекта: агенты не пушат и не мержат, не меняют .env и секреты.',
      role.id === CTO_ROLE
        ? 'Твоё слово решающее.'
        : 'Если решение выше твоего уровня или сомневаешься — подними к CTO.',
      'К человеку — только если без него нельзя: вход или креды, деньги, публикация наружу.',
      'Ответь одной-двумя фразами почему, последней строкой ровно одно: «РЕШЕНИЕ: РАЗРЕШИТЬ», «РЕШЕНИЕ: ЗАПРЕТИТЬ»' +
        (role.id === CTO_ROLE ? '' : ', «РЕШЕНИЕ: К CTO»') +
        ' или «РЕШЕНИЕ: К ЧЕЛОВЕКУ».',
    ].join('\n'),
  ]
    .filter((part) => part !== null)
    .join('\n\n')

  let text = ''
  const q = query({
    prompt,
    options: {
      model: BOARD_MODEL,
      env,
      // A decision, not a session: no tools, no settings or hooks, nothing saved
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      systemPrompt: `Ты — ${role.title}. ${role.description}`,
    },
  })
  for await (const message of q) {
    if (message.type === 'result' && message.subtype === 'success') text = message.result
  }
  const reason = text.replace(/РЕШЕНИЕ:.*$/m, '').trim() || 'без пояснения'
  return { role, decision: parseDecision(text), reason }
}

const withTimeout = <T>(work: Promise<T>) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('совет не ответил за 2 минуты')), BOARD_TIMEOUT_MS),
    ),
  ])

const line = (r: { role: Role; decision: BoardDecision; reason: string }) =>
  `${r.role.title}: ${{ allow: 'разрешить', deny: 'запретить', cto: 'к CTO', human: 'к человеку' }[r.decision]} — ${r.reason}`

// Architect and lead in parallel; both allow → allow, both deny → deny, anything else → the CTO
export const decideByBoard = async (
  ask: Ask,
  env: Record<string, string | undefined>,
): Promise<BoardOutcome> => {
  const board = boardRoles(ask.task.projectId)
  const cto = getRole(CTO_ROLE)
  try {
    const first = board.length
      ? await withTimeout(Promise.all(board.map((r) => askOne(r, ask, env))))
      : []
    const notes = first.map(line)
    if (first.some((r) => r.decision === 'human'))
      return { decision: 'human', note: notes.join('; ') }
    if (first.length && first.every((r) => r.decision === 'allow'))
      return { decision: 'allow', note: notes.join('; ') }
    if (first.length && first.every((r) => r.decision === 'deny'))
      return { decision: 'deny', note: notes.join('; ') }
    if (!cto) return { decision: 'human', note: notes.join('; ') || 'некому решить' }
    const top = await withTimeout(askOne(cto, { ...ask, earlier: notes.join('\n') }, env))
    const all = [...notes, line(top)].join('; ')
    return {
      decision: top.decision === 'allow' || top.decision === 'deny' ? top.decision : 'human',
      note: all,
    }
  } catch (error) {
    return { decision: 'human', note: error instanceof Error ? error.message : String(error) }
  }
}

export const boardNames = (projectId: string | null) =>
  boardRoles(projectId)
    .map((r) => r.title)
    .join(' и ') || 'CTO'
