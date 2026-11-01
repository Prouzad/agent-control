'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { isTaskModel } from '@/lib/roles'

import { DISPATCH_ROLE } from './TaskForm'

import { approveDispatch, cancelDispatch, ROUTER_ROLE_ID } from '@/server/dispatch'
import { removeWorktree, repoRoot } from '@/server/git'
import {
  decidePermission,
  isRunning,
  queueTask,
  sendToTask,
  setTaskPermissionMode,
  stopTask,
} from '@/server/runner'
import {
  createTask,
  deleteTask,
  editTask,
  getTask,
  isPermissionMode,
  updateTask,
  addEvent,
} from '@/server/tasks'

const optional = z
  .string()
  .trim()
  .transform((v) => v || null)

const schema = z.object({
  title: z.string().trim().min(1, 'Укажите задачу'),
  description: z.string().trim(),
  projectId: optional,
  roleId: optional,
  priority: z.coerce.number().int().min(0).max(3),
  isolation: z.enum(['worktree', 'in_place']),
  permissionMode: z.string().refine(isPermissionMode),
  budgetUsd: z
    .string()
    .trim()
    .transform((v) => (v ? Number(v.replace(',', '.')) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0), 'Бюджет — положительное число'),
  model: z.string().transform((v) => (isTaskModel(v) ? v : null)),
  start: z.boolean(),
})

const refresh = (taskId?: string) => {
  revalidatePath('/pipelines', 'layout')
  revalidatePath('/tasks')
  if (taskId) revalidatePath(`/tasks/${taskId}`)
}

const readTask = (form: FormData) =>
  schema.parse({
    title: form.get('title') ?? '',
    description: form.get('description') ?? '',
    projectId: form.get('projectId') ?? '',
    roleId: form.get('roleId') ?? '',
    priority: form.get('priority') ?? '1',
    isolation: form.get('isolation') ?? 'worktree',
    permissionMode: form.get('permissionMode') ?? 'default',
    budgetUsd: form.get('budgetUsd') ?? '',
    model: form.get('model') ?? '',
    start: form.get('start') === 'on',
  })

// «CTO решит» is stored as the router role plus the dispatch flag
const routing = (roleId: string | null) =>
  roleId === DISPATCH_ROLE
    ? { roleId: ROUTER_ROLE_ID, dispatch: 'planning' as const }
    : { roleId, dispatch: null }

export const createTaskAction = async (form: FormData) => {
  const input = readTask(form)
  if (!input.projectId) throw new Error('Выберите проект — агенту нужна папка для работы')
  const permissionMode = isPermissionMode(input.permissionMode) ? input.permissionMode : 'default'
  const id = createTask({ ...input, ...routing(input.roleId), permissionMode })
  if (input.start) queueTask(id)
  refresh()
  redirect(`/tasks/${id}`)
}

// Editing a task that already ran starts the agent over with the new text on the next run
export const editTaskAction = async (taskId: string, form: FormData) => {
  const task = getTask(taskId)
  if (!task) return
  if (isRunning(taskId) || task.status === 'running' || task.status === 'waiting') {
    throw new Error('Задача выполняется — сначала остановите её')
  }
  if (task.dispatch === 'running' || task.dispatch === 'collecting') {
    throw new Error('Лиды уже работают над задачей — её нельзя менять')
  }
  const input = readTask(form)
  if (!input.projectId) throw new Error('Выберите проект — агенту нужна папка для работы')
  const permissionMode = isPermissionMode(input.permissionMode) ? input.permissionMode : 'default'
  const moved = input.projectId !== task.projectId || input.isolation !== task.isolation
  if (moved && task.worktreePath) {
    const repo = await repoRoot(task.worktreePath)
    if (repo) await removeWorktree(repo, task.worktreePath, task.branch)
  }
  const route = routing(input.roleId)
  editTask(taskId, { ...input, roleId: route.roleId, permissionMode })
  updateTask(taskId, {
    dispatch: route.dispatch,
    ...(task.sessionId ? { sessionId: null, result: null } : {}),
    ...(moved ? { worktreePath: null, branch: null, baseCommit: null, cwd: null } : {}),
  })
  addEvent(
    taskId,
    'status',
    task.sessionId
      ? 'Задача изменена — следующий запуск начнётся с новой постановки'
      : 'Задача изменена',
  )
  refresh(taskId)
  redirect(`/tasks/${taskId}`)
}

export const approveDispatchAction = async (taskId: string) => {
  approveDispatch(taskId)
  refresh(taskId)
}

export const cancelDispatchAction = async (taskId: string) => {
  cancelDispatch(taskId)
  refresh(taskId)
}

export const queueTaskAction = async (taskId: string) => {
  queueTask(taskId)
  refresh(taskId)
}

export const stopTaskAction = async (taskId: string) => {
  await stopTask(taskId)
  refresh(taskId)
}

export const sendMessageAction = async (taskId: string, form: FormData) => {
  const text = z
    .string()
    .trim()
    .min(1)
    .parse(form.get('text') ?? '')
  sendToTask(taskId, text)
  refresh(taskId)
}

export const decidePermissionAction = async (
  permissionId: string,
  allow: boolean,
  taskId: string,
) => {
  decidePermission(permissionId, allow)
  refresh(taskId)
}

export const acceptTaskAction = async (taskId: string) => {
  updateTask(taskId, { status: 'done' })
  addEvent(taskId, 'status', 'Принято человеком')
  refresh(taskId)
}

export const reopenTaskAction = async (taskId: string) => {
  updateTask(taskId, { status: 'inbox' })
  addEvent(taskId, 'status', 'Возвращена в бэклог')
  refresh(taskId)
}

export const removeWorktreeAction = async (taskId: string) => {
  const task = getTask(taskId)
  if (!task?.worktreePath || isRunning(taskId)) return
  const repo = await repoRoot(task.worktreePath)
  if (repo) await removeWorktree(repo, task.worktreePath, task.branch)
  updateTask(taskId, { worktreePath: null, cwd: null })
  addEvent(
    taskId,
    'status',
    `Worktree удалён${task.branch ? `, ветка ${task.branch} сохранена, если в ней есть коммиты` : ''}`,
  )
  refresh(taskId)
}

export const deleteTaskAction = async (taskId: string) => {
  if (isRunning(taskId)) await stopTask(taskId)
  deleteTask(taskId)
  refresh()
  redirect('/tasks')
}

export const setTaskModeAction = async (taskId: string, mode: string) => {
  if (!isPermissionMode(mode)) return
  await setTaskPermissionMode(taskId, mode)
  refresh(taskId)
}
