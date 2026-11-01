import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  FileBarChart,
  GitBranch,
  Hand,
  RotateCcw,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { DiffPatch } from '@/components/DiffPatch'
import { LiveRefresh } from '@/components/LiveRefresh'
import { Markdown, TaskText } from '@/components/Markdown'
import { ModeSwitcher } from '@/components/ModeSwitcher'
import {
  Office3DLoader,
  type Idler,
  type OfficeStage,
  type TeamInfo,
} from '@/components/office3d/Office3DLoader'
import { Robot } from '@/components/Robot'
import { StageResult } from '@/components/StageResult'
import { Collapsible } from '@/components/Collapsible'
import { Card, PageHeader } from '@/components/ui'
import { formatDateTime, formatTime, formatTokens, formatUsd, shortPath } from '@/lib/format'
import { parseVerdict } from '@/lib/pipelines'
import { PIPELINE_CLASS, PIPELINE_LABEL, STAGE_LABEL, stageRobotState } from '@/lib/pipelineStatus'
import { worktreeStat } from '@/server/git'
import { listRoles } from '@/server/org'
import {
  ARCHIVE_DAYS,
  archiveDeletesAt,
  canArchive,
  canReworkAgain,
  getPipeline,
  pipelineMessages,
  pipelineStages,
  type Stage,
} from '@/server/pipelines'
import { getProject } from '@/server/projects'
import { addUsage, EMPTY_USAGE } from '@/server/queries'
import { getTask, listTasks, pendingPermissions, taskEvents, taskUsage } from '@/server/tasks'
import { readView, visibleRoles, visibleTeams } from '@/server/visibility'

import {
  approveStageAction,
  archivePipelineAction,
  cancelPipelineAction,
  deletePipelineAction,
  rejectStageAction,
  retryStageAction,
  reworkAgainAction,
  setPipelineModeAction,
  unarchivePipelineAction,
} from '../actions'
import { decidePermissionAction } from '@/app/tasks/actions'

import { ChatForm } from './ChatForm'

const button = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium'
const primary = 'btn-primary'
const secondary = `${button} border border-border text-text-2 hover:text-text`

const DONE: Stage['status'][] = ['done', 'approved']
const CHAT_LIMIT = 40

const clip = (text: string, max = 70) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// What the agent at this desk "says" in its speech bubble
const stageBubble = (stage: Stage, taskId: string | null, permissionTool: string | null) => {
  if (stage.kind === 'gate') {
    if (stage.status === 'waiting') return 'Ваше решение! Кнопки ниже ↓'
    if (stage.status === 'approved') return 'Одобрено ✓'
    return null
  }
  if (stage.status === 'failed') return 'Упс… что-то сломалось'
  if (stage.status === 'waiting') return 'Нужно ваше решение'
  if (stage.status === 'running') {
    if (permissionTool) return `Можно ${permissionTool}? 🙏`
    const last = taskId
      ? taskEvents(taskId, 40)
          .reverse()
          .find((e) => e.kind === 'tool' || e.kind === 'assistant')
      : undefined
    const prefix = stage.attempts > 0 ? `Доработка #${stage.attempts}: ` : ''
    if (!last) return `${prefix}Читаю задачу…`
    return (
      prefix +
      clip(last.kind === 'tool' ? `${last.toolName}: ${last.text ?? ''}` : (last.text ?? ''))
    )
  }
  if (stage.status === 'done') {
    if (stage.verdict === 'approved') return 'Одобрено! Передаю дальше'
    if (stage.verdict === 'rework') return 'Доработать!'
    return 'Готово, передаю дальше'
  }
  return null
}

const VERDICT_BADGE: Record<string, { text: string; className: string }> = {
  approved: { text: 'Одобрено', className: 'bg-good/15 text-good' },
  rework: { text: 'На доработку', className: 'bg-warning/15 text-warning' },
  unclear: { text: 'Вердикт не указан', className: 'bg-surface-2 text-text-2' },
}

const StageDecision = (props: { pipelineId: string; stage: Stage; canRework: boolean }) => (
  <div className="mt-3 flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3">
    <div className="flex flex-wrap gap-2">
      <form action={approveStageAction.bind(null, props.pipelineId, props.stage.id)}>
        <button type="submit" className={primary}>
          <Check size={14} aria-hidden />{' '}
          {props.stage.kind === 'gate' ? 'Одобрить' : 'Принять как есть'}
        </button>
      </form>
    </div>
    <form
      action={rejectStageAction.bind(null, props.pipelineId, props.stage.id)}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <textarea
        name="comment"
        required
        rows={2}
        aria-label="Комментарий"
        placeholder={
          props.stage.kind === 'gate'
            ? 'Что не так — уйдёт агенту на доработку'
            : props.canRework
              ? 'Что исправить в ещё одном круге — или почему останавливаете'
              : 'Почему останавливаете конвейер'
        }
        className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm"
      />
      <div className="flex gap-2 self-end">
        {props.canRework && (
          <button
            type="submit"
            formAction={reworkAgainAction.bind(null, props.pipelineId, props.stage.id)}
            className={`${button} border border-accent text-accent hover:bg-accent-soft`}
          >
            <RotateCcw size={14} aria-hidden /> Ещё круг доработки
          </button>
        )}
        <button type="submit" className={secondary}>
          <X size={14} aria-hidden />{' '}
          {props.stage.kind === 'gate' ? 'Вернуть на доработку' : 'Остановить'}
        </button>
      </div>
    </form>
  </div>
)

const PipelinePage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const pipeline = getPipeline(id)
  const view = await readView()
  if (!pipeline || !view.allowsProject(pipeline.projectId)) notFound()
  const stages = pipelineStages(id)
  const roleList = listRoles()
  const roles = new Map(roleList.map((r) => [r.id, r.title]))
  const roleTeams = new Map(roleList.map((r) => [r.id, r.teamId]))
  const project = pipeline.projectId ? getProject(pipeline.projectId) : undefined
  const tasks = new Map(
    stages.flatMap((s) => (s.taskId ? [[s.id, getTask(s.taskId)] as const] : [])),
  )
  const permissions = pendingPermissions()
  const waitingPermission = new Set(permissions.map((p) => p.taskId))
  // Every run counts: rework rounds and repeated checks create extra tasks for the same stage
  const pipelineTasks = listTasks().filter((t) => t.pipelineId === pipeline.id)
  const usage = taskUsage(pipelineTasks)
  const spent = pipelineTasks.reduce(
    (sum, t) => addUsage(sum, usage.get(t.id) ?? EMPTY_USAGE),
    EMPTY_USAGE,
  )
  const active = pipeline.status === 'running' || pipeline.status === 'waiting'
  // The chat: what the person said on the way, and what the agents answered, oldest first
  const stageLabels = new Map(stages.map((s) => [s.id, s.label]))
  const chat = [
    ...pipelineMessages(id).map((m) => ({
      key: `m${m.id}`,
      ts: m.createdAt,
      fromYou: true,
      text: m.text,
      who: 'Вы',
      stage: m.stageId ? (stageLabels.get(m.stageId) ?? null) : null,
    })),
    ...pipelineTasks.flatMap((t) =>
      taskEvents(t.id, 80).flatMap((e) =>
        e.kind === 'assistant' && e.text
          ? [
              {
                key: `e${e.id}`,
                ts: e.ts,
                fromYou: false,
                text: e.text,
                who: roles.get(t.roleId ?? '') ?? 'Агент',
                stage: t.stageId ? (stageLabels.get(t.stageId) ?? null) : null,
              },
            ]
          : [],
      ),
    ),
  ]
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-CHAT_LIMIT)
  const agentAtWork = stages.some((s) => {
    const task = s.taskId ? getTask(s.taskId) : undefined
    return task?.status === 'running' || task?.status === 'waiting'
  })
  // Who reads a chat message now: the agent at work, the next stage, or the pipeline's lead
  const leadStage = stages.find((s) => s.key === 'dev') ?? stages.find((s) => s.key === 'architect')
  const leadTitle = leadStage?.roleId ? (roles.get(leadStage.roleId) ?? leadStage.roleId) : 'лид'
  const chatHint = agentAtWork
    ? 'Агент на этапе получит сразу, следующие этапы — в своём задании.'
    : pipeline.status === 'running'
      ? 'Получит следующий этап в своём задании.'
      : `Ответит ${leadTitle}: продолжит свою сессию, может поручить команде или показать результат в браузере.`
  // The later agent whose verdict sent this stage back for another round
  const scolder = (stage: Stage) =>
    stage.kind === 'agent' && stage.attempts > 0
      ? stages.find(
          (s) =>
            s.idx > stage.idx &&
            s.kind === 'agent' &&
            (s.status === 'waiting' || parseVerdict(s.output) === 'rework'),
        )
      : undefined
  const office: OfficeStage[] = stages.map((stage) => {
    const task = tasks.get(stage.id)
    const permission = task ? permissions.find((p) => p.taskId === task.id) : undefined
    return {
      id: stage.id,
      kind: stage.kind,
      label: stage.label,
      roleId: stage.roleId,
      roleTitle: stage.roleId ? (roles.get(stage.roleId) ?? null) : null,
      teamId: stage.roleId ? (roleTeams.get(stage.roleId) ?? null) : null,
      taskId: task?.id ?? null,
      status: stage.status,
      robot: stageRobotState(stage, Boolean(permission)),
      bubble: stageBubble(stage, task?.id ?? null, permission?.toolName ?? null),
      papers: DONE.includes(stage.status) ? 1 + stage.attempts : stage.attempts,
      attempts: stage.attempts,
      scoldedBy: scolder(stage)?.id ?? null,
      asking: Boolean(permission),
    }
  })
  const busy = new Set(stages.map((s) => s.roleId))
  const pipelineTeams = new Set(office.map((s) => s.teamId))
  // Teammates outside this pipeline fill the free seats of their team's pod
  const teams: TeamInfo[] = visibleTeams(view)
    .filter((t) => pipelineTeams.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      mates: t.roles.filter((r) => !busy.has(r.id)).map((r) => ({ roleId: r.id, title: r.title })),
    }))
  // Leads of the other teams take a break in the kitchen and the lounge
  const idlers: Idler[] = visibleRoles(view)
    .filter((r) => !busy.has(r.id) && r.isLead && !pipelineTeams.has(r.teamId))
    .slice(0, 6)
    .map((r) => ({ roleId: r.id, teamId: r.teamId }))
  const diff =
    pipeline.worktreePath && pipeline.baseCommit
      ? await worktreeStat(pipeline.worktreePath, pipeline.baseCommit).catch(() => null)
      : null

  return (
    <>
      <LiveRefresh pipelineId={pipeline.id} taskIds={pipelineTasks.map((t) => t.id)} />
      <Link
        href="/pipelines"
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> Конвейеры
      </Link>
      <PageHeader
        title={pipeline.title}
        description={`${project?.name ?? 'Без проекта'}${pipeline.note ? ` · ${pipeline.note}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${PIPELINE_CLASS[pipeline.status]}`}
            >
              {PIPELINE_LABEL[pipeline.status]}
            </span>
            <Link href={`/pipelines/${pipeline.id}/report`} className={secondary}>
              <FileBarChart size={14} aria-hidden /> Отчёт
            </Link>
            {pipeline.archivedAt ? (
              <form action={unarchivePipelineAction.bind(null, pipeline.id)}>
                <button
                  type="submit"
                  className={secondary}
                  title={`Удалится ${formatDateTime(archiveDeletesAt(pipeline.archivedAt))}`}
                >
                  <ArchiveRestore size={14} aria-hidden /> Вернуть из архива
                </button>
              </form>
            ) : (
              canArchive(pipeline) && (
                <form action={archivePipelineAction.bind(null, pipeline.id)}>
                  <button
                    type="submit"
                    className={secondary}
                    title={`Через ${ARCHIVE_DAYS} дней в архиве конвейер удалится вместе с рабочей копией; ветка с коммитами останется`}
                  >
                    <Archive size={14} aria-hidden /> В архив
                  </button>
                </form>
              )
            )}
            {active && (
              <ModeSwitcher
                value={pipeline.permissionMode}
                action={setPipelineModeAction.bind(null, pipeline.id)}
              />
            )}
            {(pipeline.status === 'failed' || pipeline.status === 'cancelled') && (
              <Link
                href={`/pipelines?fromPipeline=${pipeline.id}#new-pipeline`}
                className={secondary}
              >
                <RotateCcw size={14} aria-hidden /> Запустить заново
              </Link>
            )}
            {active && (
              <form action={cancelPipelineAction.bind(null, pipeline.id)}>
                <button type="submit" className={secondary}>
                  <Square size={14} aria-hidden /> Остановить
                </button>
              </form>
            )}
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          {pipeline.description && (
            <Card title="Задача">
              <Collapsible>
                <TaskText text={pipeline.description} />
              </Collapsible>
            </Card>
          )}
          <Card
            solid
            title="Опенспейс"
            hint="У каждой команды своя комната, агенты носят папку с задачей, а вы решаете кнопкой"
          >
            <Office3DLoader
              stages={office}
              finished={pipeline.status === 'done'}
              idlers={idlers}
              teams={teams}
            />
          </Card>
          <Card title="Чат с конвейером" hint="Указания по ходу работы и ответы агентов">
            {chat.length > 0 ? (
              // Reversed column: the newest message sits at the bottom, scrolled into view
              <ol className="flex max-h-[28rem] flex-col-reverse gap-2 overflow-y-auto pr-1">
                {[...chat].reverse().map((item) => (
                  <li
                    key={item.key}
                    className={
                      item.fromYou
                        ? 'ml-8 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2'
                        : 'mr-8 rounded-lg bg-surface-2 px-3 py-2'
                    }
                  >
                    <div className="mb-1 text-xs text-text-3">
                      <span className={item.fromYou ? 'text-accent' : 'text-text-2'}>
                        {item.who}
                      </span>
                      {item.stage ? ` · ${item.stage}` : ''} · {formatTime(item.ts)}
                    </div>
                    {item.fromYou ? (
                      <Collapsible>
                        <TaskText text={item.text} />
                      </Collapsible>
                    ) : (
                      <Collapsible>
                        <Markdown>{item.text}</Markdown>
                      </Collapsible>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-text-3">
                Пока пусто. Напишите указание — агент на этапе получит его сразу, а следующие этапы
                прочитают в своём задании.
              </p>
            )}
            {pipeline.status !== 'cancelled' && (
              <div className="mt-3 border-t border-border pt-3">
                <ChatForm pipelineId={pipeline.id} hint={chatHint} />
              </div>
            )}
          </Card>
          <Card title="Этапы">
            <ol className="flex flex-col">
              {stages.map((stage, index) => {
                const task = tasks.get(stage.id)
                const verdict = stage.verdict ? VERDICT_BADGE[stage.verdict] : undefined
                return (
                  <li
                    key={stage.id}
                    id={`stage-${stage.id}`}
                    className="group relative flex scroll-mt-6 gap-4 pb-6 last:pb-0"
                  >
                    {index < stages.length - 1 && (
                      <span
                        className={`absolute top-14 bottom-1 left-[23px] w-0.5 rounded-full ${
                          stage.status === 'running'
                            ? 'belt'
                            : DONE.includes(stage.status)
                              ? 'bg-accent/60'
                              : 'bg-border'
                        }`}
                        aria-hidden
                      />
                    )}
                    <div className="relative flex w-12 shrink-0 justify-center">
                      {stage.kind === 'gate' ? (
                        <span
                          className={`mt-1 flex size-10 items-center justify-center rounded-xl border-2 ${
                            stage.status === 'waiting'
                              ? 'pulse-dot border-warning text-warning shadow-[0_0_16px_var(--warning)]'
                              : DONE.includes(stage.status)
                                ? 'border-accent text-accent'
                                : 'border-border text-text-3'
                          }`}
                          aria-hidden
                        >
                          <Hand size={18} />
                        </span>
                      ) : (
                        <Robot
                          seed={stage.roleId ?? stage.key}
                          team={stage.roleId ? roleTeams.get(stage.roleId) : null}
                          state={stageRobotState(
                            stage,
                            task ? waitingPermission.has(task.id) : false,
                          )}
                          size={44}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {stage.kind === 'gate' && (
                          <Hand size={14} className="text-warning" aria-hidden />
                        )}
                        <span className="font-medium">{stage.label}</span>
                        <span className="text-xs text-text-3">{STAGE_LABEL[stage.status]}</span>
                        {verdict && (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-xs ${verdict.className}`}
                          >
                            {verdict.text}
                          </span>
                        )}
                        {stage.attempts > 0 && (
                          <span className="text-xs text-text-3">доработок: {stage.attempts}</span>
                        )}
                        {task && waitingPermission.has(task.id) && (
                          <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-xs text-warning">
                            нужно разрешение
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-3">
                        {stage.roleId
                          ? (roles.get(stage.roleId) ?? stage.roleId)
                          : stage.kind === 'gate'
                            ? 'Вы'
                            : '—'}
                        {task && (
                          <>
                            {' · '}
                            <Link
                              href={`/tasks/${task.id}`}
                              className="text-accent hover:underline"
                            >
                              ход работы
                            </Link>
                            {(usage.get(task.id)?.total ?? 0) > 0 &&
                              ` · ${formatUsd(usage.get(task.id)?.costUsd ?? 0)} · ${formatTokens(usage.get(task.id)?.total ?? 0)}`}
                          </>
                        )}
                      </div>
                      {stage.output && (
                        <StageResult
                          stageId={stage.id}
                          gate={stage.kind === 'gate'}
                          // The result a waiting decision is about comes with the page, open
                          initial={
                            stage.status === 'waiting' || stages[index + 1]?.status === 'waiting'
                              ? stage.output
                              : undefined
                          }
                        />
                      )}
                      {stage.status === 'waiting' && (
                        <StageDecision
                          pipelineId={pipeline.id}
                          stage={stage}
                          canRework={canReworkAgain(stage)}
                        />
                      )}
                      {task &&
                        permissions
                          .filter((p) => p.taskId === task.id)
                          .map((permission) => (
                            <div
                              key={permission.id}
                              className="mt-3 rounded-md border border-warning/50 bg-warning/10 p-3"
                            >
                              <div className="mb-2 text-sm font-medium">
                                Агент просит разрешение: {permission.title ?? permission.toolName}
                              </div>
                              <pre className="mb-2 max-h-48 overflow-auto rounded-md bg-surface p-2 font-mono text-xs whitespace-pre-wrap text-text-2">
                                {permission.input}
                              </pre>
                              <div className="flex gap-2">
                                <form
                                  action={decidePermissionAction.bind(
                                    null,
                                    permission.id,
                                    true,
                                    task.id,
                                  )}
                                >
                                  <button type="submit" className={primary}>
                                    <Check size={14} aria-hidden /> Разрешить
                                  </button>
                                </form>
                                <form
                                  action={decidePermissionAction.bind(
                                    null,
                                    permission.id,
                                    false,
                                    task.id,
                                  )}
                                >
                                  <button type="submit" className={secondary}>
                                    <X size={14} aria-hidden /> Отклонить
                                  </button>
                                </form>
                              </div>
                            </div>
                          ))}
                      {stage.status === 'failed' && (
                        <form
                          action={retryStageAction.bind(null, pipeline.id, stage.id)}
                          className="mt-2"
                        >
                          <button type="submit" className={secondary}>
                            <RotateCcw size={14} aria-hidden /> Повторить этап
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>
          {diff && (diff.stat || diff.untracked.length > 0) && (
            <Card
              title="Изменения в ветке"
              hint={`Относительно ${pipeline.baseCommit?.slice(0, 8)}`}
            >
              <pre className="mb-3 overflow-x-auto font-mono text-xs text-text-2">{diff.stat}</pre>
              <DiffPatch source={{ pipeline: pipeline.id }} />
            </Card>
          )}
        </div>

        <Card title="Детали" className="h-fit">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-text-3">Стоимость</dt>
            <dd className="tabular">{formatUsd(spent.costUsd)}</dd>
            <dt className="text-text-3">Токены</dt>
            <dd className="tabular">{formatTokens(spent.total)}</dd>
            <dt className="text-text-3">Этапов</dt>
            <dd className="tabular">{stages.length}</dd>
            {pipeline.branch && (
              <>
                <dt className="text-text-3">Ветка</dt>
                <dd className="inline-flex min-w-0 items-center gap-1 font-mono text-xs">
                  <GitBranch size={13} aria-hidden />{' '}
                  <span className="truncate">{pipeline.branch}</span>
                </dd>
              </>
            )}
            <dt className="text-text-3">Папка</dt>
            <dd className="font-mono text-xs break-all">
              {shortPath(pipeline.cwd ?? project?.path ?? null)}
            </dd>
          </dl>
          {!active && (
            <form
              action={deletePipelineAction.bind(null, pipeline.id)}
              className="mt-4 border-t border-border pt-3"
            >
              <button
                type="submit"
                className="inline-flex items-center gap-1 text-xs text-critical hover:underline"
              >
                <Trash2 size={13} aria-hidden /> Удалить конвейер и его worktree
              </button>
            </form>
          )}
        </Card>
      </div>
    </>
  )
}

export default PipelinePage
