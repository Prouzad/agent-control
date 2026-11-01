import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import { MODEL_GUIDE, TASK_MODELS } from '@/lib/roles'

import { obj, str } from '@/lib/json'

import { bus } from './bus'
import { db } from './db'
import { getRole, listTeams, type Role } from './org'
import { effectiveTeamIds, ownTeamIds, projectWithDescendants } from './projects'
import { queueTask, sendToTask, setTaskExtras, type TaskExtras } from './runner'
import { addEvent, createTask, getTask, listTasks, updateTask, type Task } from './tasks'

// The role that routes a task to team leads
export const ROUTER_ROLE_ID = 'cto'
const SERVER = 'dashboard'
const DELEGATE_TOOL = `mcp__${SERVER}__delegate`
const RESULT_CHARS = 6_000

// Leads the CTO may hand work to: leads of the teams on the project and its sub-projects;
// a project without teams falls back to the leads of teams no project has claimed
export const dispatchLeads = (projectId: string): Role[] => {
  const teams = listTeams()
  const projectTeamIds = new Set([
    ...effectiveTeamIds(projectId),
    ...projectWithDescendants(projectId).flatMap((id) => ownTeamIds(id)),
  ])
  const bound = new Set(
    db()
      .prepare('SELECT DISTINCT team_id FROM project_teams')
      .all()
      .flatMap((row) => str(obj(row)?.['team_id']) ?? []),
  )
  const pool = projectTeamIds.size
    ? teams.filter((t) => projectTeamIds.has(t.id))
    : teams.filter((t) => !bound.has(t.id))
  return pool.flatMap((t) => t.roles.filter((r) => r.isLead && r.id !== ROUTER_ROLE_ID))
}

export const subTasks = (parentId: string): Task[] =>
  listTasks()
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.seq - b.seq)

const clip = (text: string | null) =>
  !text ? '—' : text.length > RESULT_CHARS ? `${text.slice(0, RESULT_CHARS)}…` : text

// While planning, the CTO gets a tool that turns each hand-off into a sub-task for a lead
const planningExtras = (task: Task): TaskExtras | null => {
  if (task.dispatch !== 'planning' || !task.projectId) return null
  const projectId = task.projectId
  const leads = dispatchLeads(projectId)
  const [first, ...rest] = leads.map((l) => l.id)
  if (!first) return null
  const delegate = tool(
    'delegate',
    'Поручить часть задачи лиду команды. Каждый вызов — отдельная подзадача; лиды выполняют их по очереди в порядке вызовов, в той же рабочей папке.',
    {
      lead: z.enum([first, ...rest]).describe('id роли лида'),
      title: z.string().min(1).describe('Короткое название подзадачи'),
      brief: z
        .string()
        .min(1)
        .describe('Что сделать, входные данные, что не трогать и критерий готовности'),
      model: z
        .enum(TASK_MODELS)
        .optional()
        .describe('Модель для подзадачи: sonnet — простое, opus — сложное, fable — самое трудное'),
    },
    async (args) => {
      const parent = getTask(task.id)
      const seq = subTasks(task.id).length + 1
      const id = createTask({
        title: args.title,
        description: `${args.brief}\n\n---\nПодзадача ${seq} от CTO по задаче «${parent?.title ?? task.title}».`,
        projectId,
        roleId: args.lead,
        priority: task.priority,
        isolation: 'in_place',
        permissionMode: task.permissionMode,
        budgetUsd: task.budgetUsd,
        model: args.model ?? null,
        // Sub-tasks build on each other in the parent's folder or worktree
        cwd: parent?.cwd ?? null,
        parentId: task.id,
        seq,
      })
      const lead = getRole(args.lead)
      addEvent(
        task.id,
        'status',
        `Поручено ${lead?.title ?? args.lead}${args.model ? ` (${args.model})` : ''}: ${args.title}`,
      )
      return {
        content: [{ type: 'text', text: `Подзадача ${seq} создана (${id}) для ${args.lead}.` }],
      }
    },
  )
  return {
    mcpServers: {
      [SERVER]: createSdkMcpServer({ name: SERVER, version: '1.0.0', tools: [delegate] }),
    },
    allowedTools: [DELEGATE_TOOL],
    append: [
      '# Раздача работы',
      'Сам код не пишешь. Разбери задачу, изучи нужное в коде и раздай работу лидам инструментом delegate.',
      'Порядок вызовов = порядок выполнения: сначала то, от чего зависят остальные (анализ → разработка → проверка).',
      'В бриф каждой подзадачи клади всё нужное лиду: контекст, что сделать, что не трогать, критерий готовности. Предыдущие подзадачи он не видит — их итоги ты получишь в конце сам.',
      'Не дроби лишнего: одна подзадача на лида, если работа не требует иначе. Человек одобрит раздачу до старта.',
      'Каждой подзадаче задай model. Модель лида станет моделью его сессии; своим участникам он подберёт модели сам.',
      MODEL_GUIDE,
      'Закончи коротким планом: кому что поручено, на какой модели и почему.',
      '',
      'Лиды:',
      ...leads.map((l) => `- ${l.id} — ${l.title}: ${l.description}`),
    ].join('\n'),
  }
}

// The runner starts sub-tasks from To Do in order; once all are done the CTO sums them up
const wrapUpIfDone = (parent: Task) => {
  if (subTasks(parent.id).some((t) => t.status !== 'done')) return
  // Every lead is done: the CTO gets their reports and sums them up
  updateTask(parent.id, { dispatch: 'collecting' })
  const report = subTasks(parent.id)
    .map(
      (t) =>
        `## ${t.seq}. ${t.title} (${getRole(t.roleId ?? '')?.title ?? t.roleId})\n\n${clip(t.result)}`,
    )
    .join('\n\n')
  sendToTask(
    parent.id,
    `Лиды закончили. Их отчёты:\n\n${report}\n\nПроверь, что вместе это решает исходную задачу, и дай человеку итог: что сделано, что осталось, на что посмотреть.`,
  )
}

export const approveDispatch = (parentId: string) => {
  const parent = getTask(parentId)
  if (!parent || parent.dispatch !== 'approval') return
  updateTask(parentId, { dispatch: 'running' })
  addEvent(
    parentId,
    'status',
    'Раздача одобрена — подзадачи в To Do, исполнители берут их по порядку',
  )
  // All hand-offs go to To Do at once; each waits there until the ones before it are done
  for (const sub of subTasks(parentId).filter((t) => t.status === 'inbox')) queueTask(sub.id)
}

export const cancelDispatch = (parentId: string) => {
  const parent = getTask(parentId)
  if (!parent || parent.dispatch !== 'approval') return
  for (const t of subTasks(parentId)) {
    if (t.status === 'inbox') updateTask(t.id, { status: 'cancelled' })
  }
  updateTask(parentId, { dispatch: 'done', status: 'review' })
  addEvent(parentId, 'status', 'Раздача отклонена человеком')
}

const onTaskFinished = (taskId: string) => {
  const task = getTask(taskId)
  if (!task) return

  if (task.dispatch === 'planning') {
    if (task.status !== 'review') return
    if (!subTasks(task.id).length) {
      updateTask(task.id, { dispatch: 'done' })
      return
    }
    updateTask(task.id, { status: 'waiting', dispatch: 'approval' })
    addEvent(task.id, 'status', 'Ждёт вашего одобрения раздачи')
    return
  }
  if (task.dispatch === 'collecting') {
    if (task.status === 'review') updateTask(task.id, { dispatch: 'done' })
    return
  }

  const parent = task.parentId ? getTask(task.parentId) : undefined
  if (!parent || parent.dispatch !== 'running') return
  if (task.status === 'review') {
    updateTask(task.id, { status: 'done' })
    wrapUpIfDone(parent)
    return
  }
  if (task.status === 'failed') {
    addEvent(
      parent.id,
      'error',
      `Подзадача «${task.title}» не выполнена — повторите её, и раздача продолжится`,
    )
  }
}

declare global {
  var agentControlDispatchStarted: boolean | undefined
}

export const startDispatch = () => {
  if (globalThis.agentControlDispatchStarted) return
  globalThis.agentControlDispatchStarted = true
  setTaskExtras(planningExtras)
  bus().on('task-finished', (event: unknown) => {
    const taskId = str(obj(event)?.['taskId'])
    if (taskId) onTaskFinished(taskId)
  })
}
