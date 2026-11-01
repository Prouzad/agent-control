import {
  ArrowLeft,
  Check,
  CornerLeftUp,
  GitBranch,
  Pencil,
  Play,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Workflow,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { DiffPatch } from '@/components/DiffPatch'
import { LiveRefresh } from '@/components/LiveRefresh'
import { Markdown, Report, TaskText } from '@/components/Markdown'
import { ModeSwitcher } from '@/components/ModeSwitcher'
import { Robot } from '@/components/Robot'
import { Collapsible } from '@/components/Collapsible'
import { Card, PageHeader } from '@/components/ui'
import {
  formatCompact,
  formatDateTime,
  formatTime,
  formatTokens,
  formatUsd,
  shortPath,
} from '@/lib/format'
import { modelChoiceLabel } from '@/lib/roles'
import { PERMISSION_MODE_LABEL, STATUS_CLASS, STATUS_LABEL, taskRobotState } from '@/lib/taskStatus'
import { worktreeStat, type DiffStat } from '@/server/git'
import { getRole } from '@/server/org'
import { getProject } from '@/server/projects'
import { isRunning } from '@/server/runner'
import { subTasks } from '@/server/dispatch'
import { EMPTY_USAGE } from '@/server/queries'
import { getTask, pendingPermissions, taskEvents, taskUsage, type TaskEvent } from '@/server/tasks'
import { readView } from '@/server/visibility'

import {
  acceptTaskAction,
  approveDispatchAction,
  cancelDispatchAction,
  decidePermissionAction,
  deleteTaskAction,
  queueTaskAction,
  removeWorktreeAction,
  reopenTaskAction,
  sendMessageAction,
  setTaskModeAction,
  stopTaskAction,
} from '../actions'

const button = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium'
const primary = 'btn-primary'
const secondary = `${button} border border-border text-text-2 hover:text-text`

const EVENT_STYLE: Record<TaskEvent['kind'], { label: string; className: string }> = {
  status: { label: 'статус', className: 'text-text-3' },
  prompt: { label: 'вы', className: 'text-accent' },
  assistant: { label: 'агент', className: 'text-text' },
  tool: { label: 'инструмент', className: 'text-text-2' },
  tool_error: { label: 'ошибка инструмента', className: 'text-critical' },
  permission: { label: 'разрешение', className: 'text-warning' },
  result: { label: 'итог', className: 'text-good' },
  error: { label: 'ошибка', className: 'text-critical' },
}

const loadDiff = async (worktree: string | null, base: string | null): Promise<DiffStat | null> => {
  if (!worktree || !base) return null
  try {
    return await worktreeStat(worktree, base)
  } catch {
    return null
  }
}

const TaskPage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const task = getTask(id)
  if (!task || !(await readView()).allowsProject(task.projectId)) notFound()
  const role = task.roleId ? getRole(task.roleId) : undefined
  const project = task.projectId ? getProject(task.projectId) : undefined
  const parent = task.parentId ? getTask(task.parentId) : undefined
  const subs = subTasks(task.id)
  const used = taskUsage([task, ...subs]).get(task.id) ?? EMPTY_USAGE
  const permissions = pendingPermissions(task.id)
  const events = taskEvents(task.id)
  const running = isRunning(task.id)
  const currentTool = events.findLast((e) => e.kind === 'tool')?.toolName ?? null
  const diff = ['review', 'done', 'failed', 'cancelled'].includes(task.status)
    ? await loadDiff(task.worktreePath, task.baseCommit)
    : null

  return (
    <>
      <LiveRefresh taskId={task.id} />
      <Link
        href="/tasks"
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> Задачи
      </Link>
      <PageHeader
        icon={
          <div className="relative">
            <Robot
              seed={task.roleId ?? task.id}
              team={role?.teamId}
              state={taskRobotState(task.status, permissions.length > 0)}
              size={68}
              label={role?.title ?? 'Агент'}
            />
            {running && currentTool && (
              <span className="absolute -top-3 left-1/2 max-w-28 -translate-x-1/2 truncate rounded-full border border-accent/40 bg-surface-solid px-1.5 font-mono text-[10px] text-accent shadow-[0_0_10px_var(--glow)]">
                {currentTool}
              </span>
            )}
          </div>
        }
        title={task.title}
        description={`${role?.title ?? 'Без роли'} · ${project?.name ?? 'Без проекта'} · ${PERMISSION_MODE_LABEL[task.permissionMode]}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[task.status]}`}
            >
              {STATUS_LABEL[task.status]}
            </span>
            {(task.status === 'inbox' || task.status === 'cancelled') && (
              <form action={queueTaskAction.bind(null, task.id)}>
                <button type="submit" className={primary}>
                  <Play size={14} aria-hidden /> {task.sessionId ? 'Продолжить' : 'Запустить'}
                </button>
              </form>
            )}
            {task.status === 'failed' && (
              <form action={queueTaskAction.bind(null, task.id)}>
                <button type="submit" className={primary}>
                  <RotateCcw size={14} aria-hidden /> {task.sessionId ? 'Продолжить' : 'Повторить'}
                </button>
              </form>
            )}
            {!task.pipelineId && !['done', 'cancelled'].includes(task.status) && (
              <ModeSwitcher
                value={task.permissionMode}
                action={setTaskModeAction.bind(null, task.id)}
              />
            )}
            {!task.pipelineId && !running && task.status !== 'waiting' && (
              <Link href={`/tasks/${task.id}/edit`} className={secondary}>
                <Pencil size={14} aria-hidden /> Редактировать
              </Link>
            )}
            {!task.pipelineId && !task.parentId && (
              <Link href={`/pipelines?fromTask=${task.id}#new-pipeline`} className={secondary}>
                <Workflow size={14} aria-hidden /> Запустить как конвейер
              </Link>
            )}
            {(running || task.status === 'todo') && (
              <form action={stopTaskAction.bind(null, task.id)}>
                <button type="submit" className={secondary}>
                  <Square size={14} aria-hidden /> {running ? 'Остановить' : 'Убрать из очереди'}
                </button>
              </form>
            )}
            {task.status === 'review' && (
              <form action={acceptTaskAction.bind(null, task.id)}>
                <button type="submit" className={primary}>
                  <Check size={14} aria-hidden /> Принять
                </button>
              </form>
            )}
            {(task.status === 'done' || task.status === 'review') && (
              <form action={reopenTaskAction.bind(null, task.id)}>
                <button type="submit" className={secondary}>
                  Вернуть в бэклог
                </button>
              </form>
            )}
          </div>
        }
      />

      {permissions.map((permission) => (
        <section
          key={permission.id}
          className="mb-4 rounded-lg border border-warning/50 bg-warning/10 p-4"
          aria-label="Запрос разрешения"
        >
          <div className="mb-2 text-sm font-medium">
            Агент просит разрешение: {permission.title ?? permission.toolName}
          </div>
          <pre className="mb-3 max-h-64 overflow-auto rounded-md bg-surface p-2.5 font-mono text-xs whitespace-pre-wrap text-text-2">
            {permission.input}
          </pre>
          <div className="flex gap-2">
            <form action={decidePermissionAction.bind(null, permission.id, true, task.id)}>
              <button type="submit" className={primary}>
                <Check size={14} aria-hidden /> Разрешить
              </button>
            </form>
            <form action={decidePermissionAction.bind(null, permission.id, false, task.id)}>
              <button type="submit" className={secondary}>
                <X size={14} aria-hidden /> Отклонить
              </button>
            </form>
          </div>
        </section>
      ))}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          {parent && (
            <Link
              href={`/tasks/${parent.id}`}
              className="glass inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-text-2 hover:text-text"
            >
              <CornerLeftUp size={15} className="text-accent" aria-hidden />
              Подзадача {task.seq} от CTO:{' '}
              <span className="font-medium text-text">{parent.title}</span>
            </Link>
          )}
          {(task.dispatch || subs.length > 0) && (
            <Card
              title="Раздача лидам"
              hint={
                task.dispatch === 'planning'
                  ? 'CTO разбирает задачу и раздаёт её лидам'
                  : task.dispatch === 'approval'
                    ? 'CTO раздал работу — одобрите, и лиды начнут по очереди'
                    : task.dispatch === 'running'
                      ? 'Лиды работают по очереди в одной рабочей папке'
                      : task.dispatch === 'collecting'
                        ? 'Лиды закончили — CTO сводит итог'
                        : undefined
              }
            >
              {subs.length ? (
                <ol className="flex flex-col text-sm">
                  {subs.map((sub) => (
                    <li key={sub.id} className="border-b border-border last:border-0">
                      <Link
                        href={`/tasks/${sub.id}`}
                        className="flex items-center gap-3 py-2 hover:text-accent"
                      >
                        <span className="tabular w-5 shrink-0 text-text-3">{sub.seq}.</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{sub.title}</span>
                          <span className="block truncate text-xs text-text-3">
                            {getRole(sub.roleId ?? '')?.title ?? sub.roleId}
                          </span>
                        </span>
                        <span className="tabular hidden shrink-0 text-xs text-text-2 sm:inline">
                          {formatUsd(sub.costUsd)}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[sub.status]}`}
                        >
                          {STATUS_LABEL[sub.status]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-text-3">
                  Подзадач пока нет — они появятся, когда CTO раздаст работу
                </p>
              )}
              {task.dispatch === 'approval' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={approveDispatchAction.bind(null, task.id)}>
                    <button type="submit" className={primary}>
                      <Check size={14} aria-hidden /> Запустить лидов по очереди
                    </button>
                  </form>
                  <form action={cancelDispatchAction.bind(null, task.id)}>
                    <button type="submit" className={secondary}>
                      <X size={14} aria-hidden /> Отклонить раздачу
                    </button>
                  </form>
                </div>
              )}
            </Card>
          )}
          {task.description && (
            <Card title="Задача">
              <Collapsible>
                <TaskText text={task.description} />
              </Collapsible>
            </Card>
          )}
          <Card title="Ход работы" hint={`${events.length} событий`}>
            <ol className="flex flex-col text-sm">
              {events.map((event) => {
                const style = EVENT_STYLE[event.kind]
                return (
                  <li
                    key={event.id}
                    className="flex gap-3 border-b border-border py-2 last:border-0"
                  >
                    <span className="tabular w-16 shrink-0 text-xs text-text-3">
                      {formatTime(event.ts)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs ${style.className}`}>
                        {style.label}
                        {event.toolName && (
                          <span className="ml-1.5 font-mono text-text">{event.toolName}</span>
                        )}
                      </div>
                      {event.text && (event.kind === 'result' || event.kind === 'assistant') ? (
                        event.kind === 'result' ? (
                          <Report text={event.text} />
                        ) : (
                          <Collapsible>
                            <Markdown className="text-text">{event.text}</Markdown>
                          </Collapsible>
                        )
                      ) : event.text ? (
                        <div
                          className={`whitespace-pre-wrap break-words ${
                            event.kind === 'tool' ? 'truncate text-text-2' : 'text-text'
                          } ${event.kind === 'tool_error' ? 'max-h-40 overflow-auto font-mono text-xs' : ''}`}
                        >
                          {event.text}
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
            <form
              action={sendMessageAction.bind(null, task.id)}
              className="mt-3 flex gap-2 border-t border-border pt-3"
            >
              <textarea
                name="text"
                required
                rows={2}
                aria-label="Сообщение агенту"
                placeholder={
                  running
                    ? 'Сообщение агенту — получит прямо сейчас'
                    : task.sessionId
                      ? 'Ответ агенту — сессия продолжится'
                      : 'Сообщение отправится при запуске'
                }
                className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm"
              />
              <button type="submit" className={`${primary} self-end`} aria-label="Отправить">
                <Send size={14} aria-hidden />
              </button>
            </form>
          </Card>
          {diff && (
            <Card title="Изменения агента" hint={`Относительно ${task.baseCommit?.slice(0, 8)}`}>
              {diff.stat || diff.untracked.length ? (
                <>
                  <pre className="mb-3 overflow-x-auto font-mono text-xs text-text-2">
                    {diff.stat}
                  </pre>
                  {diff.untracked.length > 0 && (
                    <p className="mb-3 text-xs text-text-2">
                      Новые файлы без коммита:{' '}
                      <span className="font-mono">{diff.untracked.join(', ')}</span>
                    </p>
                  )}
                  <DiffPatch source={{ task: task.id }} />
                </>
              ) : (
                <p className="text-sm text-text-3">Агент ничего не изменил в файлах</p>
              )}
            </Card>
          )}
        </div>

        <Card title="Детали" className="h-fit">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-text-3">Модель</dt>
            <dd>
              {task.model
                ? modelChoiceLabel(task.model)
                : role
                  ? `${modelChoiceLabel(role.model)} (у роли)`
                  : '—'}
            </dd>
            <dt className="text-text-3">Стоимость</dt>
            <dd className="tabular">
              {formatUsd(used.costUsd)}
              {task.budgetUsd ? ` из ${formatUsd(task.budgetUsd)}` : ''}
              {subs.length > 0 && <span className="text-text-3"> с подзадачами</span>}
            </dd>
            <dt className="text-text-3">Токены</dt>
            <dd className="tabular">
              {formatTokens(used.total)}
              {used.total > 0 && (
                <span className="block text-xs text-text-3">
                  вход {formatCompact(used.input)} · выход {formatCompact(used.output)} · кэш{' '}
                  {formatCompact(used.cacheRead + used.cacheWrite)}
                </span>
              )}
            </dd>
            <dt className="text-text-3">Ходов</dt>
            <dd className="tabular">{task.numTurns}</dd>
            <dt className="text-text-3">Создана</dt>
            <dd>{formatDateTime(task.createdAt)}</dd>
            <dt className="text-text-3">Запуск</dt>
            <dd>{formatDateTime(task.startedAt)}</dd>
            {task.branch && (
              <>
                <dt className="text-text-3">Ветка</dt>
                <dd className="inline-flex min-w-0 items-center gap-1 font-mono text-xs">
                  <GitBranch size={13} aria-hidden />{' '}
                  <span className="truncate">{task.branch}</span>
                </dd>
              </>
            )}
            <dt className="text-text-3">Папка</dt>
            <dd className="font-mono text-xs break-all">
              {shortPath(task.cwd ?? project?.path ?? null)}
            </dd>
            {task.sessionId && (
              <>
                <dt className="text-text-3">Сессия</dt>
                <dd>
                  <Link
                    href={`/sessions/${task.sessionId}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {task.sessionId.slice(0, 8)}
                  </Link>
                </dd>
              </>
            )}
          </dl>
          {task.error && (
            <p className="mt-3 rounded-md bg-critical/10 p-2.5 text-xs whitespace-pre-wrap text-critical [overflow-wrap:anywhere]">
              {task.error}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
            {task.worktreePath && !running && (
              <form action={removeWorktreeAction.bind(null, task.id)}>
                <button type="submit" className="text-xs text-text-2 hover:text-critical">
                  Удалить worktree (ветка с коммитами сохранится)
                </button>
              </form>
            )}
            <form action={deleteTaskAction.bind(null, task.id)}>
              <button
                type="submit"
                className="inline-flex items-center gap-1 text-xs text-critical hover:underline"
              >
                <Trash2 size={13} aria-hidden /> Удалить задачу
              </button>
            </form>
          </div>
        </Card>
      </div>
    </>
  )
}

export default TaskPage
