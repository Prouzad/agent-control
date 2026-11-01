import { query } from '@anthropic-ai/claude-agent-sdk'

import { arr, obj, str } from '@/lib/json'

import { bus } from './bus'
import { db, now } from './db'
import { listRoles } from './org'
import { effectiveTeamIds } from './projects'

// Lessons: short rules distilled from what went wrong in past work (rework verdicts, the
// person's corrections, denied permissions, failed stages). Agents get the ones for their project
// and role in the system prompt, so the next run does not repeat the mistake

export type Lesson = {
  id: number
  projectId: string
  roleId: string | null
  text: string
  source: string | null
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

// About 1500 tokens: the block sits in the cached prompt prefix, so it costs little per run
const PROMPT_BUDGET_CHARS = 6_000
const MAX_ACTIVE = 40
const MATERIAL_CHARS = 14_000
const ITEM_CHARS = 1_800
const EXTRACT_MODEL = 'sonnet'

const toLesson = (row: unknown): Lesson | undefined => {
  const r = obj(row)
  const text = str(r?.['text'])
  const projectId = str(r?.['project_id'])
  if (!r || !text || !projectId) return undefined
  return {
    id: Number(r['id']),
    projectId,
    roleId: str(r['role_id']) ?? null,
    text,
    source: str(r['source']) ?? null,
    pinned: Number(r['pinned']) === 1,
    archived: Number(r['archived']) === 1,
    createdAt: str(r['created_at']) ?? '',
    updatedAt: str(r['updated_at']) ?? '',
  }
}

export const listLessons = (projectId?: string): Lesson[] =>
  db()
    .prepare(
      `SELECT * FROM lessons ${projectId ? 'WHERE project_id = ?' : ''}
       ORDER BY archived, pinned DESC, updated_at DESC`,
    )
    .all(...(projectId ? [projectId] : []))
    .flatMap((row) => toLesson(row) ?? [])

const changed = () => bus().emit('task', { taskId: null })

export const updateLesson = (
  id: number,
  patch: Partial<{ text: string; pinned: boolean; archived: boolean; roleId: string | null }>,
) => {
  const columns: Record<string, string> = {
    text: 'text',
    pinned: 'pinned',
    archived: 'archived',
    roleId: 'role_id',
  }
  const entries = Object.entries(patch).flatMap(([key, value]) =>
    columns[key] && value !== undefined
      ? [[columns[key], typeof value === 'boolean' ? Number(value) : value] as const]
      : [],
  )
  if (!entries.length) return
  db()
    .prepare(
      `UPDATE lessons SET ${entries.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    )
    .run(...entries.map(([, v]) => v), now(), id)
  changed()
}

export const deleteLesson = (id: number) => {
  db().prepare('DELETE FROM lessons WHERE id = ?').run(id)
  changed()
}

export const addLesson = (input: {
  projectId: string
  roleId: string | null
  text: string
  source: string | null
}) => {
  const ts = now()
  db()
    .prepare(
      `INSERT INTO lessons (project_id, role_id, text, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.projectId, input.roleId, input.text.trim(), input.source, ts, ts)
  changed()
}

// The lessons an agent of these roles gets: pinned first, then the freshest, within the budget
export const lessonsPrompt = (projectId: string | null, roleIds: string[]) => {
  if (!projectId) return null
  const lessons = listLessons(projectId).filter(
    (l) => !l.archived && (l.roleId === null || roleIds.includes(l.roleId)),
  )
  const lines: string[] = []
  let size = 0
  for (const lesson of lessons) {
    const line = `- ${lesson.text}`
    if (size + line.length > PROMPT_BUDGET_CHARS) break
    lines.push(line)
    size += line.length
  }
  if (!lines.length) return null
  return [
    '# Уроки прошлых работ в этом проекте',
    'Эти правила выведены из прошлых ошибок агентов и поправок человека. Соблюдай их, если они относятся к твоей задаче:',
    ...lines,
  ].join('\n')
}

// Everything that went wrong in a pipeline, as plain text for the model to learn from
const pipelineMaterial = (pipelineId: string) => {
  const items: string[] = []
  const clip = (text: string) => (text.length > ITEM_CHARS ? `${text.slice(0, ITEM_CHARS)}…` : text)
  const taskIds = db()
    .prepare('SELECT id FROM tasks WHERE pipeline_id = ?')
    .all(pipelineId)
    .flatMap((row) => str(obj(row)?.['id']) ?? [])
  const placeholders = taskIds.map(() => '?').join(',')
  if (taskIds.length) {
    // Rework requests and the person's words sent to agents
    for (const row of db()
      .prepare(
        `SELECT e.text, t.role_id FROM task_events e JOIN tasks t ON t.id = e.task_id
         WHERE e.task_id IN (${placeholders}) AND e.kind = 'prompt'
           AND (e.text LIKE '%доработк%' OR e.text LIKE 'Сообщение человека%')
         ORDER BY e.id`,
      )
      .all(...taskIds)) {
      const r = obj(row)
      items.push(
        `[Возврат или поправка → ${str(r?.['role_id']) ?? '?'}]\n${clip(str(r?.['text']) ?? '')}`,
      )
    }
    // Denied permissions and failures
    for (const row of db()
      .prepare(
        `SELECT e.text, t.role_id FROM task_events e JOIN tasks t ON t.id = e.task_id
         WHERE e.task_id IN (${placeholders})
           AND ((e.kind = 'permission' AND e.text LIKE 'Отклонено%') OR e.kind = 'error')
         ORDER BY e.id`,
      )
      .all(...taskIds)) {
      const r = obj(row)
      items.push(
        `[Отказ или ошибка у ${str(r?.['role_id']) ?? '?'}]\n${clip(str(r?.['text']) ?? '')}`,
      )
    }
  }
  for (const row of db()
    .prepare('SELECT text FROM pipeline_messages WHERE pipeline_id = ? ORDER BY id')
    .all(pipelineId)) {
    items.push(`[Человек в чате конвейера]\n${clip(str(obj(row)?.['text']) ?? '')}`)
  }
  let size = 0
  return items.filter((item) => (size += item.length) <= MATERIAL_CHARS)
}

const parseLessons = (text: string) => {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    return arr(parsed).flatMap((item) => {
      const o = obj(item)
      const lessonText = str(o?.['text'])?.trim()
      if (!o || !lessonText) return []
      return [
        {
          text: lessonText.slice(0, 400),
          roleId: str(o['role']) ?? null,
          replaces: arr(o['replaces']).flatMap((v) => (typeof v === 'number' ? [v] : [])),
        },
      ]
    })
  } catch {
    return []
  }
}

// One short call after a pipeline ends: 0–3 durable rules, merged with what the project knows
export const extractPipelineLessons = async (
  pipeline: { id: string; title: string; projectId: string | null },
  env: Record<string, string | undefined>,
) => {
  const projectId = pipeline.projectId
  if (!projectId) return 0
  db().prepare('UPDATE pipelines SET lessons_at = ? WHERE id = ?').run(now(), pipeline.id)
  const material = pipelineMaterial(pipeline.id)
  if (!material.length) return 0

  const teamIds = effectiveTeamIds(projectId)
  const roles = listRoles().filter((r) => teamIds.includes(r.teamId))
  const existing = listLessons(projectId).filter((l) => !l.archived)
  const prompt = [
    `Конвейер «${pipeline.title}» закончился. Ниже — всё, что в нём шло не так: возвраты на доработку, поправки человека, отказы и ошибки.`,
    `## Что шло не так\n\n${material.join('\n\n')}`,
    `## Роли проекта\n${roles.map((r) => `- ${r.id} — ${r.title}`).join('\n')}`,
    existing.length
      ? `## Уже известные уроки проекта\n${existing.map((l) => `- [${l.id}] ${l.text}`).join('\n')}`
      : null,
    [
      '## Задача',
      'Выведи от 0 до 3 уроков, которые помогут агентам не повторить эти ошибки в будущих задачах этого проекта.',
      'Урок — одно короткое правило (до 250 символов) в повелительном наклонении, конкретное и проверяемое: что делать или не делать и где. Без истории этого конвейера, без имён задач и коммитов.',
      'Только устойчивые знания: правила проекта, ловушки контракта, привычные промахи. Не пиши то, что верно только для этой задачи, и общие советы вроде «будь внимателен».',
      'Если урок уточняет или заменяет известный — укажи его номер в replaces. Если ничего нового — верни [].',
      'role — id роли, которой урок нужен, или null, если он для всех.',
      'Ответь только JSON-массивом: [{"text": "...", "role": "id или null", "replaces": [номера]}]',
    ].join('\n'),
  ]
    .filter((part) => part !== null)
    .join('\n\n')

  let text = ''
  const q = query({
    prompt,
    options: {
      model: EXTRACT_MODEL,
      env,
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      systemPrompt:
        'Ты собираешь уроки для команды ИИ-агентов из их прошлых ошибок. Отвечаешь только JSON.',
    },
  })
  for await (const message of q) {
    if (message.type === 'result' && message.subtype === 'success') text = message.result
  }

  const roleIds = new Set(roles.map((r) => r.id))
  const lessons = parseLessons(text).slice(0, 3)
  for (const lesson of lessons) {
    for (const id of lesson.replaces) {
      if (existing.some((l) => l.id === id && !l.pinned)) updateLesson(id, { archived: true })
    }
    addLesson({
      projectId,
      roleId: lesson.roleId && roleIds.has(lesson.roleId) ? lesson.roleId : null,
      text: lesson.text,
      source: `Конвейер «${pipeline.title}»`,
    })
  }
  // The newest stay; the oldest unpinned beyond the cap are archived
  const active = listLessons(projectId).filter((l) => !l.archived && !l.pinned)
  for (const old of active.slice(MAX_ACTIVE)) updateLesson(old.id, { archived: true })
  return lessons.length
}
