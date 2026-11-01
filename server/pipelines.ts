import { randomUUID } from 'node:crypto'

import { obj, str } from '@/lib/json'
import { BOARD_VERDICT_RULE, MAX_REWORK_ROUNDS, parseVerdict, stageDef } from '@/lib/pipelines'

import { bus } from './bus'
import { db, now } from './db'
import {
  createWorktree,
  headCommit,
  linkEnvFiles,
  pathInWorktree,
  removeWorktree,
  repoRoot,
} from './git'
import { runnerSettings } from './settings'
import { getRole, listRoles } from './org'
import { effectiveTeamIds, getProject, projectWorkPath } from './projects'
import { extractPipelineLessons } from './lessons'
import { accountEnv, queueTask, sendToTask, setTaskPermissionMode, stopTask } from './runner'
import {
  PERMISSION_MODES,
  addEvent,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  type Task,
  type TaskPermissionMode,
} from './tasks'

const OUTPUT_CONTEXT_CHARS = 8_000

export type PipelineStatus = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'
export type StageStatus =
  'pending' | 'running' | 'waiting' | 'done' | 'approved' | 'failed' | 'skipped'

export type Pipeline = {
  id: string
  title: string
  description: string
  projectId: string | null
  template: string
  status: PipelineStatus
  note: string | null
  permissionMode: TaskPermissionMode
  stageBudgetUsd: number | null
  worktreePath: string | null
  branch: string | null
  baseCommit: string | null
  cwd: string | null
  createdAt: string
  updatedAt: string
  // Set once the pipeline is archived; it is deleted ARCHIVE_DAYS later
  archivedAt: string | null
}

export type Stage = {
  id: string
  pipelineId: string
  idx: number
  key: string
  kind: 'agent' | 'gate'
  label: string
  roleId: string | null
  taskId: string | null
  status: StageStatus
  output: string | null
  verdict: string | null
  attempts: number
  // Roles that approved in the current round of the board's review
  approvals: string[]
  // The decision went up to the CTO, or to the person
  escalation: 'cto' | 'human' | null
  // The board decides on a check stage that ran out of rework rounds
  deciding: boolean
}

const PIPELINE_STATUSES: PipelineStatus[] = ['running', 'waiting', 'done', 'failed', 'cancelled']
const STAGE_STATUSES: StageStatus[] = [
  'pending',
  'running',
  'waiting',
  'done',
  'approved',
  'failed',
  'skipped',
]

const pick = <T extends string>(options: T[], value: unknown, fallback: T): T =>
  options.find((o) => o === value) ?? fallback

const toPipeline = (row: unknown): Pipeline | undefined => {
  const r = obj(row)
  const id = str(r?.['id'])
  if (!r || !id) return undefined
  const budget = r['stage_budget_usd']
  return {
    id,
    title: str(r['title']) ?? '',
    description: str(r['description']) ?? '',
    projectId: str(r['project_id']) ?? null,
    template: str(r['template']) ?? 'custom',
    status: pick(PIPELINE_STATUSES, r['status'], 'running'),
    note: str(r['note']) ?? null,
    permissionMode: pick([...PERMISSION_MODES], r['permission_mode'], 'default'),
    stageBudgetUsd: typeof budget === 'number' ? budget : null,
    worktreePath: str(r['worktree_path']) ?? null,
    branch: str(r['branch']) ?? null,
    baseCommit: str(r['base_commit']) ?? null,
    cwd: str(r['cwd']) ?? null,
    createdAt: str(r['created_at']) ?? '',
    updatedAt: str(r['updated_at']) ?? '',
    archivedAt: str(r['archived_at']) ?? null,
  }
}

const toStage = (row: unknown): Stage | undefined => {
  const r = obj(row)
  const id = str(r?.['id'])
  const pipelineId = str(r?.['pipeline_id'])
  if (!r || !id || !pipelineId) return undefined
  return {
    id,
    pipelineId,
    idx: Number(r['idx'] ?? 0),
    key: str(r['stage_key']) ?? '',
    kind: r['kind'] === 'gate' ? 'gate' : 'agent',
    label: str(r['label']) ?? '',
    roleId: str(r['role_id']) ?? null,
    taskId: str(r['task_id']) ?? null,
    status: pick(STAGE_STATUSES, r['status'], 'pending'),
    output: str(r['output']) ?? null,
    verdict: str(r['verdict']) ?? null,
    attempts: Number(r['attempts'] ?? 0),
    approvals: parseApprovals(r['approvals']),
    escalation: r['escalation'] === 'cto' || r['escalation'] === 'human' ? r['escalation'] : null,
    deciding: Number(r['deciding'] ?? 0) === 1,
  }
}

const parseApprovals = (value: unknown): string[] => {
  try {
    const list: unknown = JSON.parse(str(value) ?? '[]')
    return Array.isArray(list) ? list.flatMap((v) => (typeof v === 'string' ? [v] : [])) : []
  } catch {
    return []
  }
}

export const listPipelines = (): Pipeline[] =>
  db()
    .prepare('SELECT * FROM pipelines ORDER BY created_at DESC')
    .all()
    .flatMap((row) => toPipeline(row) ?? [])

export const getPipeline = (id: string) =>
  toPipeline(db().prepare('SELECT * FROM pipelines WHERE id = ?').get(id))

export const pipelineStages = (pipelineId: string): Stage[] =>
  db()
    .prepare('SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY idx')
    .all(pipelineId)
    .flatMap((row) => toStage(row) ?? [])

export const getStageById = (id: string) => getStage(id)

const getStage = (id: string) =>
  toStage(db().prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(id))

// The mode applies to the stage running now and to every stage after it
export const setPipelinePermissionMode = async (pipelineId: string, mode: TaskPermissionMode) => {
  db()
    .prepare('UPDATE pipelines SET permission_mode = ?, updated_at = ? WHERE id = ?')
    .run(mode, now(), pipelineId)
  for (const task of listTasks().filter(
    (t) =>
      t.pipelineId === pipelineId && ['inbox', 'todo', 'running', 'waiting'].includes(t.status),
  )) {
    await setTaskPermissionMode(task.id, mode)
  }
  bus().emit('task', { taskId: null, pipelineId })
}

const setPipeline = (id: string, patch: { status?: PipelineStatus; note?: string | null }) => {
  const sets: string[] = []
  const values: (string | null)[] = []
  if (patch.status) {
    sets.push('status = ?')
    values.push(patch.status)
  }
  if (patch.note !== undefined) {
    sets.push('note = ?')
    values.push(patch.note)
  }
  db()
    .prepare(`UPDATE pipelines SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`)
    .run(...values, now(), id)
  bus().emit('task', { taskId: null, pipelineId: id })
  if (patch.status === 'done' || patch.status === 'failed' || patch.status === 'cancelled')
    learnFrom(id)
  // A finished pipeline goes to the archive by itself
  if (patch.status === 'done') archivePipeline(id)
}

// Once a pipeline ends, what went wrong in it becomes lessons for the project's next runs
const learnFrom = (pipelineId: string) => {
  const pipeline = getPipeline(pipelineId)
  const learned = str(
    obj(db().prepare('SELECT lessons_at FROM pipelines WHERE id = ?').get(pipelineId))?.[
      'lessons_at'
    ],
  )
  if (!pipeline?.projectId || learned) return
  const projectId = pipeline.projectId
  void accountEnv(projectId)
    .then((env) => extractPipelineLessons(pipeline, env))
    .catch(() => undefined)
}

const setStage = (
  id: string,
  patch: Partial<{
    status: StageStatus
    taskId: string | null
    output: string | null
    verdict: string | null
    attempts: number
    approvals: string[]
    escalation: 'cto' | 'human' | null
    deciding: boolean
  }>,
) => {
  const columns: Record<string, string> = {
    status: 'status',
    taskId: 'task_id',
    output: 'output',
    verdict: 'verdict',
    attempts: 'attempts',
    approvals: 'approvals',
    escalation: 'escalation',
    deciding: 'deciding',
  }
  const entries = Object.entries(patch).flatMap(([key, value]) =>
    columns[key] && value !== undefined
      ? [
          [
            columns[key],
            Array.isArray(value)
              ? JSON.stringify(value)
              : typeof value === 'boolean'
                ? Number(value)
                : value,
          ] as const,
        ]
      : [],
  )
  if (!entries.length) return
  db()
    .prepare(
      `UPDATE pipeline_stages SET ${entries.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    )
    .run(...entries.map(([, v]) => v), now(), id)
  // A stage that settled is when the report summary is worth rebuilding
  if (patch.status === 'done' || patch.status === 'approved' || patch.status === 'failed') {
    const pipelineId = getStage(id)?.pipelineId
    if (pipelineId) bus().emit('stage-finished', { pipelineId })
  }
}

export type PipelineInput = {
  title: string
  description: string
  projectId: string
  template: string
  stageKeys: string[]
  devRoleId: string | null
  permissionMode: TaskPermissionMode
  stageBudgetUsd: number | null
}

// Stage key → role from the project's teams; teams keep their order, leads come first in a team
const projectStageRoles = (projectId: string) => {
  const teamIds = effectiveTeamIds(projectId)
  const roles = listRoles()
    .filter((role) => teamIds.includes(role.teamId))
    .sort((a, b) => teamIds.indexOf(a.teamId) - teamIds.indexOf(b.teamId))
  const byStage = new Map<string, string>()
  for (const role of roles) {
    for (const key of role.stages) if (!byStage.has(key)) byStage.set(key, role.id)
  }
  return byStage
}

export const createPipeline = (input: PipelineInput) => {
  const id = randomUUID()
  const ts = now()
  const keys = input.stageKeys.filter((key) => stageDef(key))
  const teamRoles = projectStageRoles(input.projectId)
  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO pipelines (id, title, description, project_id, template, status, permission_mode,
           stage_budget_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title.trim(),
        input.description.trim(),
        input.projectId,
        input.template,
        input.permissionMode,
        input.stageBudgetUsd,
        ts,
        ts,
      )
    const insert = db().prepare(
      `INSERT INTO pipeline_stages (id, pipeline_id, idx, stage_key, kind, label, role_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    keys.forEach((key, idx) => {
      const def = stageDef(key)
      if (!def) return
      const fromTeams = teamRoles.get(key)
      const roleId = (key === 'dev' ? input.devRoleId : null) ?? fromTeams ?? def.roleId ?? null
      insert.run(randomUUID(), id, idx, key, def.kind, def.label, roleId, ts)
    })
  })()
  void start(id)
  return id
}

// One worktree for the whole pipeline: every stage reads and builds on the same branch
const start = async (pipelineId: string) => {
  const pipeline = getPipeline(pipelineId)
  const project = pipeline?.projectId ? getProject(pipeline.projectId) : undefined
  const workPath = project ? projectWorkPath(project.id) : null
  if (!pipeline || !workPath) {
    setPipeline(pipelineId, { status: 'failed', note: 'У конвейера нет проекта с папкой на диске' })
    return
  }
  try {
    const repo = await repoRoot(workPath)
    if (!repo) throw new Error(`${workPath} — не git-репозиторий`)
    const { branch, worktree } = await createWorktree(repo, pipeline.id, pipeline.title)
    const cwd = await pathInWorktree(repo, worktree, workPath)
    if (runnerSettings().allowEnvRead) await linkEnvFiles(workPath, cwd)
    db()
      .prepare(
        'UPDATE pipelines SET worktree_path = ?, branch = ?, base_commit = ?, cwd = ? WHERE id = ?',
      )
      .run(worktree, branch, await headCommit(worktree), cwd, pipeline.id)
  } catch (error) {
    setPipeline(pipelineId, {
      status: 'failed',
      note: `Не удалось создать worktree: ${error instanceof Error ? error.message : String(error)}`,
    })
    return
  }
  advance(pipelineId)
}

const stagePrompt = (pipeline: Pipeline, stage: Stage, stages: Stage[]) => {
  const def = stageDef(stage.key)
  const instruction = (def?.instruction ?? '').replaceAll(
    'BASE_COMMIT',
    pipeline.baseCommit ?? 'HEAD~1',
  )
  const previous = stages
    .filter((s) => s.idx < stage.idx && s.kind === 'agent' && s.output)
    .map((s) => {
      const output = s.output ?? ''
      const clipped =
        output.length > OUTPUT_CONTEXT_CHARS
          ? `${output.slice(0, OUTPUT_CONTEXT_CHARS)}\n…(обрезано)`
          : output
      return `### ${s.label}\n${clipped}`
    })
  const notes = pipelineMessages(pipeline.id).map((m) => `- ${m.text.replaceAll('\n', '\n  ')}`)
  // Human decisions outrank the task text: they are the latest word on what is wanted
  const decisions = stages
    .filter((s) => s.kind === 'gate' && s.output)
    .map((s) => `### ${s.label}\n${s.output ?? ''}`)
  return [
    `Это этап конвейера «${pipeline.title}». Ты работаешь в ветке ${pipeline.branch ?? ''}, общей для всех этапов.`,
    `## Задача\n${pipeline.description || pipeline.title}`,
    decisions.length
      ? `## Решения на гейтах — человека или CTO с лидом (важнее текста задачи)\n\n${decisions.join('\n\n')}`
      : null,
    notes.length
      ? `## Указания человека по ходу работы (новее и важнее текста задачи)\n\n${notes.join('\n')}`
      : null,
    `## Твой этап: ${stage.label}\n${instruction}`,
    previous.length ? `## Результаты предыдущих этапов\n\n${previous.join('\n\n')}` : null,
  ]
    .filter((part) => part !== null)
    .join('\n\n')
}

// Decisions other than the release go to a board instead of the person: the project's architect
// and its development lead, both must approve. A question above their level goes up to the CTO,
// and only what nobody but a person can do comes to the person
const CTO_ROLE = 'cto'

const boardReviewers = (pipeline: Pipeline, stages: Stage[]) => {
  const roles = projectStageRoles(pipeline.projectId ?? '')
  const architect = stages.find((s) => s.key === 'architect')?.roleId ?? roles.get('architect')
  const devLead = stages.find((s) => s.key === 'dev')?.roleId ?? roles.get('dev')
  const board = [architect, devLead].filter((r): r is string => Boolean(r))
  return board.length ? [...new Set(board)] : [CTO_ROLE]
}

const roleTitle = (roleId: string | null) => getRole(roleId ?? '')?.title ?? roleId ?? 'проверяющий'

const boardInstruction = (stage: Stage, reviewer: string) =>
  [
    reviewer === CTO_ROLE
      ? `Решение по «${stage.label}» поднято к тебе как к CTO: архитектор или лид разработки сочли его выше своего уровня либо не сошлись. Их отзывы — выше. Твоё слово решающее.`
      : `Ты решаешь «${stage.label}» вместо человека вместе со вторым проверяющим (архитектор и лид разработки).`,
    stage.deciding
      ? `Этап «${stage.label}» исчерпал автоматические круги доработки. Реши: принять как есть (оставшиеся замечания не блокируют), отправить на ещё один круг (перечисли, что исправить) или поднять выше.`
      : stage.key === 'plan_gate'
        ? 'Проверь план архитектора: решает ли он задачу, реалистичен ли, нет ли рисков и пропусков, верно ли разбит на шаги, подходят ли шагам выбранные модели (если нет — исправь модель в своих ответах).'
        : 'Проверь итог разработки и проверок: готово ли это, нет ли открытых блокеров.',
    'Ответь на вопросы, которые предыдущие этапы оставили человеку: опирайся на рекомендации, ТЗ и здравый смысл. Где решать должен продукт, но вопрос не блокирует, выбери самый безопасный вариант и пометь это.',
    'Код и файлы не меняй, работу команде не поручай — это проверка.',
    `В «Подробно» перечисли ответы на вопросы — их получат следующие этапы.\n${BOARD_VERDICT_RULE.replace(
      reviewer === CTO_ROLE ? /\n- «ВЕРДИКТ: К CTO»[^\n]*/ : /$^/,
      '',
    )}`,
  ].join('\n')

const toPerson = (stage: Stage, why: string) => {
  setStage(stage.id, { status: 'waiting', escalation: 'human' })
  setPipeline(stage.pipelineId, { status: 'waiting', note: `${stage.label}: ${why} — решите сами` })
}

// The next reviewer in line, or the outcome once everyone needed has approved
const startBoardReview = (pipeline: Pipeline, stage: Stage, stages: Stage[]) => {
  const reviewer =
    stage.escalation === 'cto'
      ? CTO_ROLE
      : boardReviewers(pipeline, stages).find((role) => !stage.approvals.includes(role))
  if (!reviewer) {
    boardApproved(stage)
    return
  }
  const what = stage.deciding ? 'решение по этапу' : 'гейт'
  const taskId = createTask({
    title: `${stage.label}: ${what} (${roleTitle(reviewer)}) · ${pipeline.title}`,
    description: [
      stagePrompt(pipeline, stage, stages),
      stage.deciding && stage.output ? `## Итог этапа «${stage.label}»\n${stage.output}` : null,
      `## Твоя роль\n${boardInstruction(stage, reviewer)}`,
    ]
      .filter((part) => part !== null)
      .join('\n\n'),
    projectId: pipeline.projectId,
    roleId: reviewer,
    priority: 1,
    isolation: 'in_place',
    permissionMode: 'auto',
    budgetUsd: pipeline.stageBudgetUsd,
    cwd: pipeline.cwd,
    pipelineId: pipeline.id,
    stageId: stage.id,
  })
  setStage(stage.id, { status: 'running', taskId })
  setPipeline(pipeline.id, {
    status: 'running',
    note: `${stage.label}: ${stage.deciding ? 'решает' : 'проверяет'} ${roleTitle(reviewer)}`,
  })
  queueTask(taskId)
}

const boardApproved = (stage: Stage) => {
  setStage(stage.id, {
    status: stage.kind === 'gate' ? 'approved' : 'done',
    deciding: false,
    escalation: null,
    approvals: [],
  })
  advance(stage.pipelineId)
}

const onBoardReview = (stage: Stage, task: Task) => {
  const verdict = parseVerdict(task.result)
  const who = roleTitle(task.roleId)
  const label = {
    approved: 'одобрено',
    rework: 'на доработку',
    cto: 'к CTO',
    human: 'к человеку',
  }[verdict ?? 'human']
  const record = `### ${who}: ${label}\n\n${task.result ?? ''}`
  // A gate's record feeds later stages as its decision; a check stage keeps its own report
  if (stage.kind === 'gate') {
    setStage(stage.id, { output: stage.output ? `${stage.output}\n\n${record}` : record })
  }
  const fromCto = task.roleId === CTO_ROLE

  if (verdict === 'approved') {
    if (fromCto) return boardApproved(stage)
    setStage(stage.id, { status: 'pending', approvals: [...stage.approvals, task.roleId ?? who] })
    const fresh = getStage(stage.id)
    const pipeline = getPipeline(stage.pipelineId)
    if (fresh && pipeline) startBoardReview(pipeline, fresh, pipelineStages(stage.pipelineId))
    return
  }
  if (verdict === 'cto' && !fromCto) {
    setStage(stage.id, { status: 'pending', escalation: 'cto' })
    const fresh = getStage(stage.id)
    const pipeline = getPipeline(stage.pipelineId)
    if (fresh && pipeline) startBoardReview(pipeline, fresh, pipelineStages(stage.pipelineId))
    return
  }
  if (verdict !== 'rework') {
    toPerson(stage, `${who} просит решения человека`)
    return
  }

  // Rework: a gate sends the work to its reworkTo stage, a stalled check back to development
  const stages = pipelineStages(stage.pipelineId)
  const target = stage.deciding
    ? stages.find((s) => s.key === 'dev' && s.taskId)
    : stages.find((s) => s.key === stageDef(stage.key)?.reworkTo && s.taskId)
  const rounds = stage.attempts + 1
  // Out of rounds the CTO decides; when the CTO is out of rounds too, the person does
  if (!target || rounds > MAX_REWORK_ROUNDS + (fromCto ? 1 : 0)) {
    if (!fromCto && target) {
      setStage(stage.id, { status: 'pending', escalation: 'cto' })
      const fresh = getStage(stage.id)
      const pipeline = getPipeline(stage.pipelineId)
      if (fresh && pipeline) startBoardReview(pipeline, fresh, stages)
      return
    }
    toPerson(stage, `${who} не одобрил${target ? ', круги доработки исчерпаны' : ''}`)
    return
  }
  setStage(stage.id, { attempts: rounds, approvals: [], escalation: null, deciding: false })
  reworkFrom(
    stage.pipelineId,
    target,
    stage,
    [
      `${who} ${stage.deciding ? `решил отправить работу после этапа «${stage.label}» на ещё один круг` : `на гейте «${stage.label}» вернул работу на доработку`}. Учти замечания и ответы на вопросы:`,
      task.result ?? '',
      stage.deciding && stage.output ? `## Итог этапа «${stage.label}»\n${stage.output}` : null,
    ]
      .filter((part) => part !== null)
      .join('\n\n'),
  )
}

const DONE_STATUSES: StageStatus[] = ['done', 'approved', 'skipped']

// Moves the pipeline to its first unfinished stage and starts it
export const advance = (pipelineId: string) => {
  const pipeline = getPipeline(pipelineId)
  if (!pipeline || pipeline.status === 'cancelled' || pipeline.status === 'failed') return
  const stages = pipelineStages(pipelineId)
  const stage = stages.find((s) => !DONE_STATUSES.includes(s.status))
  if (!stage) {
    setPipeline(pipelineId, { status: 'done', note: 'Все этапы пройдены' })
    return
  }
  if (stage.status === 'running' || stage.status === 'waiting') return
  if (stage.status === 'failed') {
    setPipeline(pipelineId, { status: 'failed', note: `Этап «${stage.label}» не выполнен` })
    return
  }
  if (stage.kind === 'gate') {
    if (!stageDef(stage.key)?.humanOnly && stage.escalation !== 'human') {
      startBoardReview(pipeline, stage, stages)
      return
    }
    setStage(stage.id, { status: 'waiting' })
    setPipeline(pipelineId, { status: 'waiting', note: `${stage.label}: ждёт вас` })
    return
  }
  const taskId = createTask({
    title: `${stage.label} · ${pipeline.title}`,
    description: stagePrompt(pipeline, stage, stages),
    projectId: pipeline.projectId,
    roleId: stage.roleId,
    priority: 1,
    isolation: 'in_place',
    permissionMode: pipeline.permissionMode,
    budgetUsd: pipeline.stageBudgetUsd,
    cwd: pipeline.cwd,
    pipelineId,
    stageId: stage.id,
  })
  setStage(stage.id, { status: 'running', taskId, output: null, verdict: null })
  setPipeline(pipelineId, { status: 'running', note: `Идёт этап «${stage.label}»` })
  queueTask(taskId)
}

// Sends the work back to a stage that already has a session, with feedback; later stages run again
const reworkFrom = (pipelineId: string, target: Stage, through: Stage, feedback: string) => {
  const stages = pipelineStages(pipelineId)
  for (const s of stages) {
    if (s.idx > target.idx && s.idx <= through.idx)
      setStage(s.id, {
        status: 'pending',
        verdict: null,
        approvals: [],
        escalation: null,
        deciding: false,
      })
  }
  setStage(target.id, { status: 'running', attempts: target.attempts + 1 })
  setPipeline(pipelineId, { status: 'running', note: `Доработка: «${target.label}»` })
  if (target.taskId) sendToTask(target.taskId, feedback)
}

const onTaskFinished = (taskId: string) => {
  const task = getTask(taskId)
  if (!task?.pipelineId || !task.stageId) return
  const stage = getStage(task.stageId)
  // Repeated signals for the same run are ignored
  if (!stage || stage.status !== 'running' || stage.taskId !== taskId) return
  if (task.status === 'todo' || task.status === 'running' || task.status === 'waiting') return
  const pipelineId = task.pipelineId

  if (task.status !== 'review') {
    setStage(stage.id, { status: 'failed', output: task.error })
    setPipeline(pipelineId, {
      status: 'failed',
      note: `Этап «${stage.label}» не выполнен: ${task.error ?? task.status}`,
    })
    return
  }

  updateTask(task.id, { status: 'done' })
  if (stage.kind === 'gate' || stage.deciding) {
    onBoardReview(stage, task)
    return
  }
  const def = stageDef(stage.key)
  if (!def?.check) {
    setStage(stage.id, { status: 'done', output: task.result })
    advance(pipelineId)
    return
  }

  const verdict = parseVerdict(task.result)
  setStage(stage.id, { output: task.result, verdict: verdict ?? 'unclear' })
  if (verdict !== 'rework') {
    setStage(stage.id, { status: 'done' })
    advance(pipelineId)
    return
  }
  const dev = pipelineStages(pipelineId).find((s) => s.key === 'dev')
  if (!dev?.taskId || dev.attempts >= MAX_REWORK_ROUNDS) {
    // Out of automatic rounds: the architect and the development lead decide, not the person
    const pipeline = getPipeline(pipelineId)
    const fresh = getStage(stage.id)
    if (!dev?.taskId || !pipeline || !fresh || fresh.escalation === 'human') {
      setStage(stage.id, { status: 'waiting' })
      setPipeline(pipelineId, {
        status: 'waiting',
        note: `«${stage.label}» снова просит доработку — лимит из ${MAX_REWORK_ROUNDS} кругов исчерпан, решите сами`,
      })
      return
    }
    // attempts keeps counting the board's extra rounds, so they cannot go on forever
    setStage(stage.id, { deciding: true, approvals: [] })
    const deciding = getStage(stage.id)
    if (deciding) startBoardReview(pipeline, deciding, pipelineStages(pipelineId))
    return
  }
  reworkFrom(
    pipelineId,
    dev,
    stage,
    `Этап «${stage.label}» вернул работу на доработку. Исправь замечания и снова закоммить:\n\n${task.result ?? ''}`,
  )
}

export const approveStage = (stageId: string) => {
  const stage = getStage(stageId)
  if (!stage || stage.status !== 'waiting') return
  setStage(stageId, { status: stage.kind === 'gate' ? 'approved' : 'done' })
  if (stage.taskId) addEvent(stage.taskId, 'status', 'Человек принял результат этапа')
  advance(stage.pipelineId)
}

export const rejectStage = (stageId: string, comment: string) => {
  const stage = getStage(stageId)
  if (!stage || stage.status !== 'waiting') return
  if (stage.kind !== 'gate') {
    cancelPipeline(stage.pipelineId, `Остановлено человеком на этапе «${stage.label}»`)
    return
  }
  setStage(stageId, { output: `${stage.output ? `${stage.output}\n` : ''}• Отклонено: ${comment}` })
  const def = stageDef(stage.key)
  const target = pipelineStages(stage.pipelineId).find((s) => s.key === def?.reworkTo && s.taskId)
  if (!target) {
    cancelPipeline(stage.pipelineId, `«${stage.label}» отклонено: ${comment}`)
    return
  }
  reworkFrom(
    stage.pipelineId,
    target,
    stage,
    `Человек отклонил «${stage.label}» с комментарием:\n\n${comment}\n\nДоработай с учётом комментария.`,
  )
}

export type PipelineMessage = {
  id: number
  stageId: string | null
  text: string
  createdAt: string
}

export const pipelineMessages = (pipelineId: string): PipelineMessage[] =>
  db()
    .prepare('SELECT * FROM pipeline_messages WHERE pipeline_id = ? ORDER BY id')
    .all(pipelineId)
    .flatMap((row) => {
      const r = obj(row)
      const text = str(r?.['text'])
      if (!r || !text) return []
      return [
        {
          id: Number(r['id']),
          stageId: str(r['stage_id']) ?? null,
          text,
          createdAt: str(r['created_at']) ?? '',
        },
      ]
    })

// A message from the person: the agent at work gets it now, every later stage reads it in its
// prompt. Returns whether an agent got it live
// With nobody at work (the pipeline waits for the person or is over), a question goes to the
// pipeline's main agent: the lead who built it, in its own session with all the context
const MAIN_STAGES = ['dev', 'architect']
const LEAD_BRIEF = [
  'Вопрос или просьба человека в чате конвейера. Этапы уже прошли или ждут его решения — ты главный агент этого конвейера и отвечаешь ему.',
  'Ответь коротко и по делу. Если нужен другой специалист — поручи участнику команды и перескажи итог.',
  'Хочет посмотреть результат в браузере — подними dev-сервер ветки (проверь, не поднят ли уже), дай ссылку и как войти, сервер не останавливай, пока он не скажет.',
  'Просит правки — сделай их в ветке, прогони проверки и закоммить. Без просьбы код не меняй. Push и merge не делаешь.',
].join('\n')

const mainAgentTask = (pipelineId: string) => {
  const stages = pipelineStages(pipelineId)
  const candidates = [
    ...MAIN_STAGES.map((key) => stages.find((s) => s.key === key)),
    ...[...stages].reverse().filter((s) => s.kind === 'agent'),
  ]
  for (const stage of candidates) {
    const task = stage?.taskId ? getTask(stage.taskId) : undefined
    if (task?.sessionId) return task
  }
  return undefined
}

export const sayToPipeline = (pipelineId: string, text: string, answer = true) => {
  const pipeline = getPipeline(pipelineId)
  if (!pipeline || pipeline.status === 'cancelled') return false
  const stage = pipelineStages(pipelineId).find(
    (s) => (s.status === 'running' || s.status === 'waiting') && s.taskId,
  )
  const task = stage?.taskId ? getTask(stage.taskId) : undefined
  db()
    .prepare(
      'INSERT INTO pipeline_messages (pipeline_id, stage_id, text, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(pipelineId, stage?.id ?? null, text, now())
  bus().emit('task', { taskId: null, pipelineId })
  if (task && (task.status === 'running' || task.status === 'waiting')) {
    sendToTask(task.id, `Сообщение человека по ходу конвейера:\n\n${text}`)
    return true
  }
  // Running between stages: the next stage reads it in its prompt
  if (!answer || pipeline.status === 'running') return false
  const main = mainAgentTask(pipelineId)
  if (!main) return false
  sendToTask(main.id, `${LEAD_BRIEF}\n\n## Сообщение человека\n${text}`)
  return true
}

// A check stage out of automatic rounds: the person sends the work back to development once
// more, with their own note on top of the stage's findings
export const canReworkAgain = (stage: Stage) =>
  stage.kind === 'agent' &&
  stage.status === 'waiting' &&
  Boolean(stageDef(stage.key)?.check) &&
  pipelineStages(stage.pipelineId).some((s) => s.key === 'dev' && s.taskId)

export const reworkAgain = (stageId: string, comment: string) => {
  const stage = getStage(stageId)
  if (!stage || !canReworkAgain(stage)) return
  const dev = pipelineStages(stage.pipelineId).find((s) => s.key === 'dev' && s.taskId)
  if (!dev) return
  if (comment) sayToPipeline(stage.pipelineId, comment, false)
  if (stage.taskId) addEvent(stage.taskId, 'status', 'Человек отправил на ещё один круг доработки')
  reworkFrom(
    stage.pipelineId,
    dev,
    stage,
    [
      `Человек отправил работу на ещё один круг доработки после этапа «${stage.label}».`,
      comment ? `## Что сделать (решение человека)\n${comment}` : null,
      `## Замечания этапа «${stage.label}»\n${stage.output ?? ''}`,
    ]
      .filter((part) => part !== null)
      .join('\n\n'),
  )
}

export const retryStage = (stageId: string) => {
  const stage = getStage(stageId)
  if (!stage || stage.status !== 'failed') return
  // A stage whose agent was cut off resumes its session instead of starting over
  const previous = stage.taskId ? getTask(stage.taskId) : undefined
  if (previous?.sessionId) {
    setStage(stageId, { status: 'running', output: null })
    setPipeline(stage.pipelineId, { status: 'running', note: `Продолжаю этап «${stage.label}»` })
    sendToTask(
      previous.id,
      'Прошлый запуск этапа оборвался, работа участников могла не дойти до конца. Проверь, что уже сделано (git status, git log, проверки), доделай остальное и подведи итог всего этапа.',
    )
    return
  }
  setStage(stageId, { status: 'pending', taskId: null, output: null })
  setPipeline(stage.pipelineId, { status: 'running', note: null })
  advance(stage.pipelineId)
}

export const cancelPipeline = async (pipelineId: string, note = 'Остановлено человеком') => {
  setPipeline(pipelineId, { status: 'cancelled', note })
  for (const stage of pipelineStages(pipelineId)) {
    if (stage.taskId && (stage.status === 'running' || stage.status === 'waiting'))
      await stopTask(stage.taskId)
    if (stage.status === 'running' || stage.status === 'waiting' || stage.status === 'pending') {
      setStage(stage.id, { status: 'skipped' })
    }
  }
}

export const deletePipeline = async (pipelineId: string) => {
  const pipeline = getPipeline(pipelineId)
  if (!pipeline) return
  await cancelPipeline(pipelineId)
  // Rework rounds leave earlier runs of a stage behind, so remove every task of the pipeline
  for (const task of listTasks().filter((t) => t.pipelineId === pipelineId)) deleteTask(task.id)
  if (pipeline.worktreePath) {
    const repo = await repoRoot(pipeline.worktreePath)
    if (repo)
      await removeWorktree(repo, pipeline.worktreePath, pipeline.branch).catch(() => undefined)
  }
  db().prepare('DELETE FROM pipeline_stages WHERE pipeline_id = ?').run(pipelineId)
  db().prepare('DELETE FROM pipelines WHERE id = ?').run(pipelineId)
  bus().emit('task', { taskId: null, pipelineId })
}

export const ARCHIVE_DAYS = 14
const ARCHIVABLE: PipelineStatus[] = ['done', 'failed', 'cancelled']
const PURGE_EVERY_MS = 6 * 60 * 60 * 1000

// Only a pipeline that is no longer working can be archived
export const canArchive = (pipeline: Pipeline) =>
  !pipeline.archivedAt && ARCHIVABLE.includes(pipeline.status)

export const archivePipeline = (pipelineId: string) => {
  const pipeline = getPipeline(pipelineId)
  if (!pipeline || !canArchive(pipeline)) return false
  db().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?').run(now(), pipelineId)
  bus().emit('task', { taskId: null, pipelineId })
  return true
}

export const unarchivePipeline = (pipelineId: string) => {
  db().prepare('UPDATE pipelines SET archived_at = NULL WHERE id = ?').run(pipelineId)
  bus().emit('task', { taskId: null, pipelineId })
}

export const archiveDeletesAt = (archivedAt: string) =>
  new Date(Date.parse(archivedAt) + ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString()

// Archived pipelines older than two weeks are deleted with their worktree; a branch with commits
// merged nowhere else stays in the repository, so no work is lost
const purgeArchive = async () => {
  const cutoff = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  for (const pipeline of listPipelines()) {
    if (pipeline.archivedAt && pipeline.archivedAt < cutoff) await deletePipeline(pipeline.id)
  }
}

declare global {
  var agentControlPipelinesStarted: boolean | undefined
}

// Must subscribe before the runner starts, so restart failures reach their pipelines
export const startPipelines = () => {
  if (globalThis.agentControlPipelinesStarted) return
  globalThis.agentControlPipelinesStarted = true
  void purgeArchive()
  setInterval(() => void purgeArchive(), PURGE_EVERY_MS)
  bus().on('task-finished', (event: unknown) => {
    const taskId = str(obj(event)?.['taskId'])
    if (taskId) onTaskFinished(taskId)
  }) // A running pipeline whose next stage never started (the dashboard restarted in between)
  // picks up where it stopped
  for (const pipeline of listPipelines()) {
    // A stage whose agent finished while nobody listened is settled now
    if (pipeline.status === 'running') {
      const stage = pipelineStages(pipeline.id).find((s) => s.status === 'running' && s.taskId)
      const task = stage?.taskId ? getTask(stage.taskId) : undefined
      if (task && !['todo', 'running', 'waiting'].includes(task.status)) onTaskFinished(task.id)
      advance(pipeline.id)
    }
    // A decision left waiting for the person before the board existed goes to the board now:
    // a gate other than the release, or a check stage out of rework rounds
    if (pipeline.status === 'waiting') {
      const stage = pipelineStages(pipeline.id).find(
        (s) =>
          s.status === 'waiting' &&
          s.escalation === null &&
          ((s.kind === 'gate' && !stageDef(s.key)?.humanOnly) ||
            (s.kind === 'agent' && Boolean(stageDef(s.key)?.check))),
      )
      if (stage) {
        setStage(stage.id, { status: 'pending', deciding: stage.kind === 'agent', approvals: [] })
        setPipeline(pipeline.id, { status: 'running', note: null })
        const fresh = getStage(stage.id)
        if (fresh) startBoardReview(pipeline, fresh, pipelineStages(pipeline.id))
      }
    }
  }
}
