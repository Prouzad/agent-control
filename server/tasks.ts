import { randomUUID } from 'node:crypto'

import { obj, str } from '@/lib/json'
import { isTaskModel, type TaskModel } from '@/lib/roles'

import { bus } from './bus'
import { db, now } from './db'
import { addUsage, EMPTY_USAGE, usageBySession, type TokenUsage } from './queries'

export const TASK_STATUSES = [
  'inbox',
  'todo',
  'running',
  'waiting',
  'review',
  'done',
  'failed',
  'cancelled',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const isTaskStatus = (value: unknown): value is TaskStatus =>
  TASK_STATUSES.some((s) => s === value)

export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'plan'] as const
export type TaskPermissionMode = (typeof PERMISSION_MODES)[number]

export const isPermissionMode = (value: unknown): value is TaskPermissionMode =>
  PERMISSION_MODES.some((m) => m === value)

export type Task = {
  id: string
  title: string
  description: string
  projectId: string | null
  roleId: string | null
  status: TaskStatus
  priority: number
  isolation: 'worktree' | 'in_place'
  permissionMode: TaskPermissionMode
  budgetUsd: number | null
  // Picked for this task over the role's model; null keeps the role's
  model: TaskModel | null
  sessionId: string | null
  worktreePath: string | null
  branch: string | null
  baseCommit: string | null
  cwd: string | null
  result: string | null
  error: string | null
  costUsd: number
  numTurns: number
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
  pipelineId: string | null
  stageId: string | null
  // Set on a sub-task a CTO handed to a lead; seq is its place in the hand-off order
  parentId: string | null
  seq: number
  dispatch: DispatchState | null
}

// planning: the CTO splits the task; approval: the split waits for a person;
// running: leads work through the sub-tasks in order; collecting: the CTO sums them up
export const DISPATCH_STATES = ['planning', 'approval', 'running', 'collecting', 'done'] as const
export type DispatchState = (typeof DISPATCH_STATES)[number]
const isDispatchState = (value: unknown): value is DispatchState =>
  DISPATCH_STATES.some((s) => s === value)

const toTask = (row: unknown): Task | undefined => {
  const r = obj(row)
  const id = str(r?.['id'])
  const status = r?.['status']
  const mode = r?.['permission_mode']
  if (!r || !id || !isTaskStatus(status)) return undefined
  const budget = r['budget_usd']
  return {
    id,
    title: str(r['title']) ?? '',
    description: str(r['description']) ?? '',
    projectId: str(r['project_id']) ?? null,
    roleId: str(r['role_id']) ?? null,
    status,
    priority: Number(r['priority'] ?? 1),
    isolation: r['isolation'] === 'in_place' ? 'in_place' : 'worktree',
    permissionMode: isPermissionMode(mode) ? mode : 'default',
    budgetUsd: typeof budget === 'number' ? budget : null,
    model: isTaskModel(r['model']) ? r['model'] : null,
    sessionId: str(r['session_id']) ?? null,
    worktreePath: str(r['worktree_path']) ?? null,
    branch: str(r['branch']) ?? null,
    baseCommit: str(r['base_commit']) ?? null,
    cwd: str(r['cwd']) ?? null,
    result: str(r['result']) ?? null,
    error: str(r['error']) ?? null,
    costUsd: Number(r['cost_usd'] ?? 0),
    numTurns: Number(r['num_turns'] ?? 0),
    createdAt: str(r['created_at']) ?? '',
    updatedAt: str(r['updated_at']) ?? '',
    startedAt: str(r['started_at']) ?? null,
    finishedAt: str(r['finished_at']) ?? null,
    pipelineId: str(r['pipeline_id']) ?? null,
    stageId: str(r['stage_id']) ?? null,
    parentId: str(r['parent_id']) ?? null,
    seq: Number(r['seq'] ?? 0),
    dispatch: isDispatchState(r['dispatch']) ? r['dispatch'] : null,
  }
}

export const listTasks = (): Task[] =>
  db()
    .prepare('SELECT * FROM tasks ORDER BY priority DESC, created_at')
    .all()
    .flatMap((row) => toTask(row) ?? [])

export const getTask = (id: string) =>
  toTask(db().prepare('SELECT * FROM tasks WHERE id = ?').get(id))

// Next task the dispatcher should start. A lead's sub-task waits in To Do until the hand-off is
// approved and every sub-task before it is done
export const nextQueuedTask = () =>
  toTask(
    db()
      .prepare(
        `SELECT * FROM tasks t WHERE t.status = 'todo' AND (
           t.parent_id IS NULL OR (
             (SELECT p.dispatch FROM tasks p WHERE p.id = t.parent_id) = 'running'
             AND NOT EXISTS (
               SELECT 1 FROM tasks s
               WHERE s.parent_id = t.parent_id AND s.seq < t.seq AND s.status != 'done'
             )
           )
         )
         ORDER BY t.priority DESC, t.created_at LIMIT 1`,
      )
      .get(),
  )

export type TaskInput = {
  title: string
  description: string
  projectId: string | null
  roleId: string | null
  priority: number
  isolation: 'worktree' | 'in_place'
  permissionMode: TaskPermissionMode
  budgetUsd: number | null
  model?: TaskModel | null
  // Set for pipeline stages: they run in the pipeline's shared worktree
  cwd?: string | null
  pipelineId?: string | null
  stageId?: string | null
  parentId?: string | null
  seq?: number
  dispatch?: DispatchState | null
}

export const createTask = (input: TaskInput) => {
  const id = randomUUID()
  const ts = now()
  db()
    .prepare(
      `INSERT INTO tasks (id, title, description, project_id, role_id, status, priority, isolation,
         permission_mode, budget_usd, model, cwd, pipeline_id, stage_id, parent_id, seq, dispatch,
         created_at, updated_at)
       VALUES (@id, @title, @description, @projectId, @roleId, @status, @priority, @isolation,
         @permissionMode, @budgetUsd, @model, @cwd, @pipelineId, @stageId, @parentId, @seq, @dispatch,
         @ts, @ts)`,
    )
    .run({
      id,
      title: input.title.trim(),
      description: input.description.trim(),
      projectId: input.projectId,
      roleId: input.roleId,
      status: 'inbox',
      priority: input.priority,
      isolation: input.isolation,
      permissionMode: input.permissionMode,
      budgetUsd: input.budgetUsd,
      model: input.model ?? null,
      cwd: input.cwd ?? null,
      pipelineId: input.pipelineId ?? null,
      parentId: input.parentId ?? null,
      seq: input.seq ?? 0,
      dispatch: input.dispatch ?? null,
      stageId: input.stageId ?? null,
      ts,
    })
  addEvent(id, 'status', 'Задача создана')
  return id
}

// What a person can change in a task; run state is left alone
export const editTask = (id: string, input: Omit<TaskInput, 'cwd' | 'pipelineId' | 'stageId'>) => {
  db()
    .prepare(
      `UPDATE tasks SET title = @title, description = @description, project_id = @projectId,
         role_id = @roleId, priority = @priority, isolation = @isolation,
         permission_mode = @permissionMode, budget_usd = @budgetUsd, model = @model,
         updated_at = @ts
       WHERE id = @id`,
    )
    .run({
      id,
      title: input.title.trim(),
      description: input.description.trim(),
      projectId: input.projectId,
      roleId: input.roleId,
      priority: input.priority,
      isolation: input.isolation,
      permissionMode: input.permissionMode,
      budgetUsd: input.budgetUsd,
      model: input.model ?? null,
      ts: now(),
    })
  bus().emit('task', { taskId: id })
}

type TaskPatch = Partial<{
  status: TaskStatus
  sessionId: string | null
  worktreePath: string | null
  branch: string | null
  baseCommit: string | null
  cwd: string | null
  result: string | null
  error: string | null
  costUsd: number
  numTurns: number
  startedAt: string | null
  finishedAt: string | null
  dispatch: DispatchState | null
}>

const COLUMNS: Record<keyof TaskPatch, string> = {
  status: 'status',
  sessionId: 'session_id',
  worktreePath: 'worktree_path',
  branch: 'branch',
  baseCommit: 'base_commit',
  cwd: 'cwd',
  result: 'result',
  error: 'error',
  costUsd: 'cost_usd',
  numTurns: 'num_turns',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  dispatch: 'dispatch',
}

const isPatchKey = (key: string): key is keyof TaskPatch => key in COLUMNS

export const updateTask = (id: string, patch: TaskPatch) => {
  const entries = Object.entries(patch).flatMap(([key, value]) =>
    isPatchKey(key) && value !== undefined ? [[COLUMNS[key], value] as const] : [],
  )
  if (!entries.length) return
  const sets = entries.map(([column]) => `${column} = ?`).join(', ')
  db()
    .prepare(`UPDATE tasks SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, value]) => value), now(), id)
  bus().emit('task', { taskId: id })
}

export const deleteTask = (id: string) => {
  db().prepare('DELETE FROM tasks WHERE id = ?').run(id)
  bus().emit('task', { taskId: id })
}

export type TaskEventKind =
  'status' | 'prompt' | 'assistant' | 'tool' | 'tool_error' | 'permission' | 'result' | 'error'

export type TaskEvent = {
  id: number
  ts: string
  kind: TaskEventKind
  text: string | null
  toolName: string | null
  isError: boolean
}

const EVENT_KINDS: TaskEventKind[] = [
  'status',
  'prompt',
  'assistant',
  'tool',
  'tool_error',
  'permission',
  'result',
  'error',
]
const isEventKind = (value: unknown): value is TaskEventKind => EVENT_KINDS.some((k) => k === value)

export const addEvent = (
  taskId: string,
  kind: TaskEventKind,
  text: string | null,
  extra?: { toolName?: string; isError?: boolean },
) => {
  db()
    .prepare(
      'INSERT INTO task_events (task_id, ts, kind, text, tool_name, is_error) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(taskId, now(), kind, text, extra?.toolName ?? null, extra?.isError ? 1 : 0)
  bus().emit('task', { taskId })
}

export const taskEvents = (taskId: string, limit = 500): TaskEvent[] =>
  db()
    .prepare(
      'SELECT * FROM (SELECT * FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id',
    )
    .all(taskId, limit)
    .flatMap((row) => {
      const r = obj(row)
      const kind = r?.['kind']
      if (!r || !isEventKind(kind)) return []
      return [
        {
          id: Number(r['id']),
          ts: str(r['ts']) ?? '',
          kind,
          text: str(r['text']) ?? null,
          toolName: str(r['tool_name']) ?? null,
          isError: r['is_error'] === 1,
        },
      ]
    })

export type PermissionRequest = {
  id: string
  taskId: string
  ts: string
  toolName: string
  title: string | null
  input: string
  status: 'pending' | 'allowed' | 'denied'
}

const toPermission = (row: unknown): PermissionRequest | undefined => {
  const r = obj(row)
  const id = str(r?.['id'])
  const taskId = str(r?.['task_id'])
  const status = r?.['status']
  if (!r || !id || !taskId) return undefined
  return {
    id,
    taskId,
    ts: str(r['ts']) ?? '',
    toolName: str(r['tool_name']) ?? '',
    title: str(r['title']) ?? null,
    input: str(r['input']) ?? '{}',
    status: status === 'allowed' || status === 'denied' ? status : 'pending',
  }
}

export const createPermissionRequest = (
  taskId: string,
  toolName: string,
  title: string | null,
  input: unknown,
) => {
  const id = randomUUID()
  db()
    .prepare(
      'INSERT INTO permission_requests (id, task_id, ts, tool_name, title, input) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, taskId, now(), toolName, title, JSON.stringify(input, null, 2).slice(0, 20_000))
  bus().emit('task', { taskId })
  return id
}

export const resolvePermissionRequest = (id: string, allowed: boolean) => {
  db()
    .prepare(
      "UPDATE permission_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
    )
    .run(allowed ? 'allowed' : 'denied', now(), id)
}

export const pendingPermissions = (taskId?: string): PermissionRequest[] =>
  db()
    .prepare(
      taskId
        ? "SELECT * FROM permission_requests WHERE status = 'pending' AND task_id = ? ORDER BY ts"
        : "SELECT * FROM permission_requests WHERE status = 'pending' ORDER BY ts",
    )
    .all(...(taskId ? [taskId] : []))
    .flatMap((row) => toPermission(row) ?? [])

export const getPermissionRequest = (id: string) =>
  toPermission(db().prepare('SELECT * FROM permission_requests WHERE id = ?').get(id))

// What a task's agent has used so far. A run cut short never reports its cost, so the indexed
// transcript is the fuller source; a CTO task also counts its leads' sub-tasks
export const taskUsage = (tasks: Task[]): Map<string, TokenUsage> => {
  const bySession = usageBySession(tasks.flatMap((t) => (t.sessionId ? [t.sessionId] : [])))
  const own = new Map(
    tasks.map((t) => {
      const usage = (t.sessionId ? bySession.get(t.sessionId) : undefined) ?? EMPTY_USAGE
      return [t.id, { ...usage, costUsd: Math.max(usage.costUsd, t.costUsd) }]
    }),
  )
  return new Map(
    tasks.map((t) => [
      t.id,
      tasks
        .filter((sub) => sub.parentId === t.id)
        .reduce(
          (sum, sub) => addUsage(sum, own.get(sub.id) ?? EMPTY_USAGE),
          own.get(t.id) ?? EMPTY_USAGE,
        ),
    ]),
  )
}

export const setPermissionModeColumn = (taskId: string, mode: TaskPermissionMode) => {
  db()
    .prepare('UPDATE tasks SET permission_mode = ?, updated_at = ? WHERE id = ?')
    .run(mode, now(), taskId)
  bus().emit('task', { taskId })
}
