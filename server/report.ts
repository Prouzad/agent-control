import { query } from '@anthropic-ai/claude-agent-sdk'

import { arr, obj, str } from '@/lib/json'

import { bus } from './bus'
import { db, now } from './db'
import { getRole } from './org'
import { accountEnv } from './runner'
import { getPipeline, pipelineMessages, pipelineStages, type Pipeline } from './pipelines'
import { listTasks, taskUsage } from './tasks'

// The pipeline report: figures counted from the data, plus a model's plain-language summary of
// the stage reports (what was done, what was checked, problems, blockers, decisions, next steps)

export type StageFacts = {
  id: string
  label: string
  kind: 'agent' | 'gate'
  status: string
  verdict: string | null
  attempts: number
  role: string | null
  runs: number
  costUsd: number
  tokens: number
  ms: number
}

export type CheckResult = 'ok' | 'issue' | 'not_checked'
export type Severity = 'blocker' | 'major' | 'minor'

export type ReportText = {
  summary: string
  done: string[]
  checked: { what: string; result: CheckResult; note: string }[]
  problems: { severity: Severity; text: string; where: string }[]
  blockers: { text: string; who: string }[]
  decisions: string[]
  next: string[]
}

const REPORT_MODEL = 'sonnet'
const STAGE_CHARS = 3_500
const TOTAL_CHARS = 45_000

export const stageFacts = (pipelineId: string): StageFacts[] => {
  const tasks = listTasks().filter((t) => t.pipelineId === pipelineId)
  const usage = taskUsage(tasks)
  return pipelineStages(pipelineId).map((stage) => {
    const runs = tasks.filter((t) => t.stageId === stage.id)
    const ms = runs.reduce((sum, t) => {
      if (!t.startedAt) return sum
      const end = t.finishedAt ? Date.parse(t.finishedAt) : Date.now()
      return sum + Math.max(0, end - Date.parse(t.startedAt))
    }, 0)
    return {
      id: stage.id,
      label: stage.label,
      kind: stage.kind,
      status: stage.status,
      verdict: stage.verdict,
      attempts: stage.attempts,
      role: stage.roleId ? (getRole(stage.roleId)?.title ?? stage.roleId) : null,
      runs: runs.length,
      costUsd: runs.reduce((sum, t) => sum + (usage.get(t.id)?.costUsd ?? t.costUsd), 0),
      tokens: runs.reduce((sum, t) => sum + (usage.get(t.id)?.total ?? 0), 0),
      ms,
    }
  })
}

const isCheck = (v: unknown): v is CheckResult => v === 'ok' || v === 'issue' || v === 'not_checked'
const isSeverity = (v: unknown): v is Severity => v === 'blocker' || v === 'major' || v === 'minor'
const strings = (v: unknown) =>
  arr(v).flatMap((s) => (typeof s === 'string' && s.trim() ? [s.trim()] : []))

const parseReport = (value: unknown): ReportText | null => {
  const o = obj(value)
  const summary = str(o?.['summary'])
  if (!o || !summary) return null
  return {
    summary,
    done: strings(o['done']),
    checked: arr(o['checked']).flatMap((c) => {
      const i = obj(c)
      const what = str(i?.['what'])
      return what && isCheck(i?.['result'])
        ? [{ what, result: i['result'], note: str(i['note']) ?? '' }]
        : []
    }),
    problems: arr(o['problems']).flatMap((p) => {
      const i = obj(p)
      const text = str(i?.['text'])
      return text && isSeverity(i?.['severity'])
        ? [{ severity: i['severity'], text, where: str(i['where']) ?? '' }]
        : []
    }),
    blockers: arr(o['blockers']).flatMap((b) => {
      const i = obj(b)
      const text = str(i?.['text'])
      return text ? [{ text, who: str(i?.['who']) ?? '' }] : []
    }),
    decisions: strings(o['decisions']),
    next: strings(o['next']),
  }
}

export const readReport = (pipelineId: string) => {
  const r = obj(
    db().prepare('SELECT report, report_at FROM pipelines WHERE id = ?').get(pipelineId),
  )
  const raw = str(r?.['report'])
  let report: ReportText | null = null
  if (raw) {
    try {
      report = parseReport(JSON.parse(raw))
    } catch {
      report = null
    }
  }
  return { report, at: str(r?.['report_at']) ?? null }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

// One call over the stage reports, the gate decisions and the chat; the answer is kept
export const generateReport = async (
  pipeline: Pipeline,
  env: Record<string, string | undefined>,
) => {
  const stages = pipelineStages(pipeline.id)
  const parts = stages
    .filter((s) => s.output)
    .map(
      (s) =>
        `### ${s.label} — ${s.status}${s.verdict ? `, вердикт ${s.verdict}` : ''}${s.attempts ? `, кругов доработки ${s.attempts}` : ''}\n${clip(s.output ?? '', STAGE_CHARS)}`,
    )
  const chat = pipelineMessages(pipeline.id).map((m) => `- ${clip(m.text, 600)}`)
  let material = [
    `Состояние конвейера: ${pipeline.status}${pipeline.note ? ` — ${pipeline.note}` : ''}`,
    ...parts,
    chat.length ? `### Сообщения человека в чате\n${chat.join('\n')}` : '',
  ].join('\n\n')
  material = clip(material, TOTAL_CHARS)

  const prompt = [
    `Конвейер «${pipeline.title}». Задача:\n${clip(pipeline.description || pipeline.title, 2_000)}`,
    `## Отчёты этапов\n\n${material}`,
    [
      '## Что нужно',
      'Собери отчёт для человека, который не читал этапы: подробно по сути, но коротко и простыми словами, без внутренних кодов там, где можно обойтись.',
      'Опирайся только на отчёты выше, ничего не придумывай. Если чего-то не проверяли — так и пиши.',
      'Ответь только JSON такого вида:',
      '{"summary": "3–5 предложений: что за работа, чем закончилась, что сейчас ждёт",',
      ' "done": ["что сделано — по пункту на результат"],',
      ' "checked": [{"what": "что проверяли", "result": "ok | issue | not_checked", "note": "чем и что вышло"}],',
      ' "problems": [{"severity": "blocker | major | minor", "text": "проблема", "where": "этап или место"}],',
      ' "blockers": [{"text": "что мешает закончить", "who": "кто снимает: человек, команда, продукт…"}],',
      ' "decisions": ["принятые решения и кем"],',
      ' "next": ["что сделать дальше, по порядку"]}',
    ].join('\n'),
  ].join('\n\n')

  let text = ''
  const q = query({
    prompt,
    options: {
      model: REPORT_MODEL,
      env,
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      systemPrompt:
        'Ты составляешь понятные отчёты о работе команды ИИ-агентов. Отвечаешь только JSON.',
    },
  })
  for await (const message of q) {
    if (message.type === 'result' && message.subtype === 'success') text = message.result
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let report: ReportText | null = null
  try {
    report = start >= 0 && end > start ? parseReport(JSON.parse(text.slice(start, end + 1))) : null
  } catch {
    report = null
  }
  if (!report) throw new Error('Модель вернула отчёт в неожиданном виде, попробуйте ещё раз')
  db()
    .prepare('UPDATE pipelines SET report = ?, report_at = ? WHERE id = ?')
    .run(JSON.stringify(report), now(), pipeline.id)
  bus().emit('task', { taskId: null, pipelineId: pipeline.id })
  return report
}

export const reportAuto = (pipelineId: string) =>
  Number(
    obj(db().prepare('SELECT report_auto FROM pipelines WHERE id = ?').get(pipelineId))?.[
      'report_auto'
    ] ?? 1,
  ) === 1

export const setReportAuto = (pipelineId: string, on: boolean) => {
  db()
    .prepare('UPDATE pipelines SET report_auto = ? WHERE id = ?')
    .run(on ? 1 : 0, pipelineId)
  bus().emit('task', { taskId: null, pipelineId })
}

declare global {
  var agentControlReportUpdates: boolean | undefined
}

// Waits a little after a stage settles: a gate approval and the next stage's start often come
// together, and one rebuild covers both
const AUTO_DELAY_MS = 8_000
const pending = new Map<string, ReturnType<typeof setTimeout>>()

export const startReportUpdates = () => {
  if (globalThis.agentControlReportUpdates) return
  globalThis.agentControlReportUpdates = true
  bus().on('stage-finished', (event: unknown) => {
    const pipelineId = str(obj(event)?.['pipelineId'])
    if (!pipelineId || !reportAuto(pipelineId)) return
    const waiting = pending.get(pipelineId)
    if (waiting) clearTimeout(waiting)
    pending.set(
      pipelineId,
      setTimeout(() => {
        pending.delete(pipelineId)
        const pipeline = getPipeline(pipelineId)
        if (!pipeline?.projectId) return
        void accountEnv(pipeline.projectId)
          .then((env) => generateReport(pipeline, env))
          .catch(() => undefined)
      }, AUTO_DELAY_MS),
    )
  })
}
