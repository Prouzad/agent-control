import { Cpu, MemoryStick, PauseCircle } from 'lucide-react'
import Link from 'next/link'

import { LiveRefresh } from '@/components/LiveRefresh'
import { Robot } from '@/components/Robot'
import { Card, PageHeader } from '@/components/ui'
import { formatTokens, formatUsd } from '@/lib/format'
import {
  BOARD,
  boardColumn,
  PRIORITY_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  taskRobotState,
} from '@/lib/taskStatus'
import { listRoles } from '@/server/org'
import { projectNames } from '@/server/projects'
import { runnerStatus } from '@/server/runner'
import { pendingPermissions, taskUsage, type Task } from '@/server/tasks'
import { readView, visibleProjectOptions, visibleTasks, visibleTeams } from '@/server/visibility'

import { createTaskAction } from './actions'
import { TaskForm } from './TaskForm'

// What a card says about where the task stands
const cardStatus = (task: Task, needsPermission: boolean, subs: number) => {
  if (needsPermission) return 'Нужно разрешение'
  if (task.dispatch === 'planning' && task.status !== 'inbox') return 'Разбирает'
  if (task.dispatch === 'approval') return `Одобрите раздачу · ${subs}`
  if (task.dispatch === 'running') return 'Лиды работают'
  if (task.dispatch === 'collecting') return 'Сводит итог'
  return STATUS_LABEL[task.status]
}

const Progress = (props: { done: number; total: number }) => (
  <span className="flex items-center gap-2 text-[11px] text-text-3">
    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${(props.done / props.total) * 100}%` }}
      />
    </span>
    <span className="tabular">
      {props.done} из {props.total}
    </span>
  </span>
)

const TasksPage = async () => {
  // Pipeline stages live on their pipeline's page
  const view = await readView()
  const tasks = visibleTasks(view).filter((t) => !t.pipelineId)
  const roleList = listRoles()
  const roles = new Map(roleList.map((r) => [r.id, r.title]))
  const roleTeams = new Map(roleList.map((r) => [r.id, r.teamId]))
  const names = projectNames()
  const waitingFor = new Set(pendingPermissions().map((p) => p.taskId))
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const usage = taskUsage(tasks)
  const subsOf = new Map<string, Task[]>()
  for (const t of tasks) {
    if (t.parentId) subsOf.set(t.parentId, [...(subsOf.get(t.parentId) ?? []), t])
  }
  const status = await runnerStatus()
  const projects = visibleProjectOptions(view)

  return (
    <>
      <LiveRefresh />
      <PageHeader
        title="Задачи"
        description="Новая задача попадает в бэклог, CTO разбирает её и раздаёт подзадачи в To Do, исполнители берут их по порядку. Разрешения и ответы — на странице задачи."
      />

      <div
        className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text-2"
        aria-live="polite"
      >
        <span className="inline-flex items-center gap-1.5">
          <Cpu size={14} aria-hidden /> Агентов: {status.running} из {status.maxParallel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MemoryStick size={14} aria-hidden /> Свободно памяти: {status.freeMemoryPercent}%
          (минимум {status.minFreeMemoryPercent}%)
        </span>
        {status.heldBack && (
          <span className="inline-flex items-center gap-1.5 text-warning">
            <PauseCircle size={14} aria-hidden /> {status.heldBack}
          </span>
        )}
      </div>

      <div className="mb-6 grid snap-x snap-mandatory auto-cols-[85%] grid-flow-col items-start gap-3 overflow-x-auto pb-2 sm:auto-cols-[minmax(12.5rem,1fr)] sm:snap-none md:items-stretch">
        {BOARD.map((column) => {
          const items = tasks.filter((t) => boardColumn(t) === column.key)
          return (
            <section
              key={column.key}
              className="relative snap-start overflow-hidden rounded-2xl border border-border bg-surface-2 p-2"
              aria-label={column.label}
            >
              {column.key === 'active' && items.length > 0 && (
                <span className="belt absolute inset-x-0 top-0 h-0.5" aria-hidden />
              )}
              <h2 className="flex items-center justify-between px-1.5 pt-1 text-xs font-semibold tracking-wider text-text-2 uppercase">
                {column.label}
                <span className="tabular rounded-full bg-surface-2 px-1.5 text-text-3">
                  {items.length}
                </span>
              </h2>
              <p className="mb-2 px-1.5 text-[11px] text-text-3">{column.hint}</p>
              <ul className="flex flex-col gap-2">
                {items.map((task) => {
                  const parent = task.parentId ? byId.get(task.parentId) : undefined
                  const subs = subsOf.get(task.id) ?? []
                  const blockedBy =
                    task.status === 'todo' && parent
                      ? subs.length === 0 &&
                        (subsOf.get(parent.id) ?? []).find(
                          (s) => s.seq < task.seq && s.status !== 'done',
                        )
                      : undefined
                  return (
                    <li key={task.id}>
                      <Link
                        href={`/tasks/${task.id}`}
                        className="group glass flex gap-2.5 rounded-xl p-3 text-sm"
                      >
                        <Robot
                          seed={task.roleId ?? task.id}
                          team={task.roleId ? roleTeams.get(task.roleId) : null}
                          state={taskRobotState(task.status, waitingFor.has(task.id))}
                          size={34}
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                          {parent && (
                            <span className="truncate text-[11px] text-text-3">
                              ↳ {task.seq}. из «{parent.title}»
                            </span>
                          )}
                          <span className="line-clamp-2 font-medium">{task.title}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span
                              className={`rounded-full px-1.5 py-0.5 ${STATUS_CLASS[task.status]}`}
                            >
                              {cardStatus(task, waitingFor.has(task.id), subs.length)}
                            </span>
                            {blockedBy && (
                              <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-text-3">
                                после №{blockedBy.seq}
                              </span>
                            )}
                            {task.priority >= 2 && (
                              <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-warning">
                                {PRIORITY_LABEL[task.priority]}
                              </span>
                            )}
                          </span>
                          {(task.dispatch === 'running' || task.dispatch === 'collecting') &&
                            subs.length > 0 && (
                              <Progress
                                done={subs.filter((s) => s.status === 'done').length}
                                total={subs.length}
                              />
                            )}
                          <span className="truncate text-xs text-text-3">
                            {task.dispatch
                              ? 'CTO'
                              : task.roleId
                                ? (roles.get(task.roleId) ?? task.roleId)
                                : 'Без роли'}
                            {task.projectId ? ` · ${names.get(task.projectId) ?? ''}` : ''}
                          </span>
                          {(usage.get(task.id)?.total ?? 0) > 0 && (
                            <span className="tabular text-xs text-text-3">
                              {formatUsd(usage.get(task.id)?.costUsd ?? 0)} ·{' '}
                              {formatTokens(usage.get(task.id)?.total ?? 0)}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  )
                })}
                {!items.length && (
                  <li className="px-1 py-3 text-center text-xs text-text-3">Пусто</li>
                )}
              </ul>
            </section>
          )
        })}
      </div>

      <div id="new-task" className="scroll-mt-6" />
      <Card title="Новая задача" className="max-w-4xl">
        {projects.length ? (
          <TaskForm
            action={createTaskAction}
            submitLabel="Создать задачу"
            projects={projects}
            teams={visibleTeams(view)}
          />
        ) : (
          <p className="text-sm text-text-2">
            Сначала создайте проект с папкой на диске на странице{' '}
            <Link href="/projects" className="text-accent hover:underline">
              Проекты
            </Link>
            .
          </p>
        )}
      </Card>
    </>
  )
}

export default TasksPage
