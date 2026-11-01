import Link from 'next/link'

import { LiveRefresh } from '@/components/LiveRefresh'
import { PageHeader } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { PIPELINE_CLASS, PIPELINE_LABEL, STAGE_LABEL } from '@/lib/pipelineStatus'
import { ARCHIVE_DAYS, archiveDeletesAt, getPipeline, pipelineStages } from '@/server/pipelines'
import { projectNames, projectWorkPath } from '@/server/projects'
import type { SearchParams } from '@/lib/scope'
import { repoRoot } from '@/server/git'
import { getTask } from '@/server/tasks'
import {
  readView,
  visiblePipelines,
  visibleProjectOptions,
  visibleTeams,
} from '@/server/visibility'

import { createPipelineAction } from './actions'
import { NewPipelineModal } from './NewPipelineModal'
import { PipelineForm } from './PipelineForm'

// Teams whose roles can own the development stage
const DEV_TEAMS = ['frontend', 'backend', 'mobile', 'platform', 'data', 'release']

const PipelinesPage = async (props: { searchParams: SearchParams }) => {
  const params = await props.searchParams
  const view = await readView()
  const all = visiblePipelines(view)
  // Filters: every status of a live pipeline, plus the archive
  const filter = typeof params['status'] === 'string' ? params['status'] : 'all'
  const active = all.filter((p) => !p.archivedAt)
  const archived = all.filter((p) => p.archivedAt)
  const tabs = [
    { key: 'all', label: 'Все', count: active.length },
    ...(['running', 'waiting', 'failed', 'cancelled', 'done'] as const).map((status) => ({
      key: status,
      label: PIPELINE_LABEL[status],
      count: active.filter((p) => p.status === status).length,
    })),
    { key: 'archive', label: 'Архив', count: archived.length },
  ].filter((tab) => tab.key === 'all' || tab.key === filter || tab.count > 0)
  const pipelines =
    filter === 'archive'
      ? archived
      : filter === 'all'
        ? active
        : active.filter((p) => p.status === filter)
  const names = projectNames()
  // A pipeline needs a git repository for its worktree: say so next to projects that lack one
  const projects = await Promise.all(
    visibleProjectOptions(view).map(async (option) => {
      const dir = projectWorkPath(option.id)
      const git = dir ? Boolean(await repoRoot(dir)) : false
      return git ? option : { ...option, label: `${option.label} — не git, конвейер не запустится` }
    }),
  )
  // The form can start from a task, or from an earlier pipeline to run it again
  const fromTaskId = typeof params['fromTask'] === 'string' ? params['fromTask'] : null
  const fromPipelineId = typeof params['fromPipeline'] === 'string' ? params['fromPipeline'] : null
  const origin = fromTaskId
    ? getTask(fromTaskId)
    : fromPipelineId
      ? getPipeline(fromPipelineId)
      : undefined
  const source = origin && view.allowsProject(origin.projectId) ? origin : undefined
  const devRoles = visibleTeams(view)
    // Starter dev teams, plus any team with a role that takes the development stage
    .filter((t) => DEV_TEAMS.includes(t.id) || t.roles.some((r) => r.stages.includes('dev')))
    .map((t) => ({ team: t.name, roles: t.roles.map((r) => ({ id: r.id, label: r.title })) }))

  return (
    <>
      <LiveRefresh />
      <PageHeader
        title="Конвейеры"
        description="Задача проходит по командам сама: анализ, план, разработка, ревью, QA, релиз. На гейтах ждёт вашего решения."
        actions={
          <NewPipelineModal
            title={
              source
                ? `${fromPipelineId ? 'Заново' : 'Новый конвейер из задачи'}: «${source.title}»`
                : 'Новый конвейер'
            }
            hint={source ? 'Текст и проект подставлены — проверьте проект и этапы' : undefined}
            prefilled={Boolean(source)}
          >
            {projects.length ? (
              <PipelineForm
                key={source?.id ?? 'new'}
                action={createPipelineAction}
                projects={projects}
                devRoles={devRoles}
                defaults={
                  source
                    ? {
                        title: source.title,
                        description: source.description,
                        projectId: source.projectId,
                      }
                    : undefined
                }
              />
            ) : (
              <p className="text-sm text-text-2">
                Сначала создайте проект на странице{' '}
                <Link href="/projects" className="text-accent hover:underline">
                  Проекты
                </Link>
                .
              </p>
            )}
          </NewPipelineModal>
        }
      />
      <nav className="mb-3 flex flex-wrap gap-1.5" aria-label="Фильтр по статусу">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === 'all' ? '/pipelines' : `/pipelines?status=${tab.key}`}
            aria-current={tab.key === filter ? 'page' : undefined}
            className={`rounded-full px-3 py-1 text-sm ${
              tab.key === filter
                ? 'bg-accent-soft text-accent'
                : 'text-text-2 hover:bg-surface-2 hover:text-text'
            }`}
          >
            {tab.label} <span className="tabular text-text-3">{tab.count}</span>
          </Link>
        ))}
      </nav>
      {filter === 'archive' && (
        <p className="mb-3 text-xs text-text-3">
          Завершённые конвейеры попадают сюда сами. Через {ARCHIVE_DAYS} дней в архиве конвейер
          удаляется вместе с рабочей копией; ветка с непушнутыми коммитами остаётся в репозитории.
        </p>
      )}
      <div className="mb-6 flex flex-col gap-3">
        {pipelines.map((pipeline) => {
          const stages = pipelineStages(pipeline.id)
          return (
            <Link
              key={pipeline.id}
              href={`/pipelines/${pipeline.id}`}
              className="flex flex-col gap-3 glass rounded-2xl p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{pipeline.title}</div>
                  <div className="text-xs text-text-3">
                    {pipeline.projectId ? names.get(pipeline.projectId) : 'Без проекта'} ·{' '}
                    {formatDateTime(pipeline.createdAt)}
                    {pipeline.note ? ` · ${pipeline.note}` : ''}
                    {pipeline.archivedAt
                      ? ` · удалится ${formatDateTime(archiveDeletesAt(pipeline.archivedAt))}`
                      : ''}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${PIPELINE_CLASS[pipeline.status]}`}
                >
                  {PIPELINE_LABEL[pipeline.status]}
                </span>
              </div>
              <ol className="flex items-center gap-1" aria-label="Этапы">
                {stages.map((stage) => (
                  <li
                    key={stage.id}
                    title={`${stage.label}: ${STAGE_LABEL[stage.status]}`}
                    className={`h-1.5 flex-1 rounded-full ${
                      stage.status === 'running'
                        ? 'belt'
                        : stage.status === 'waiting'
                          ? 'bg-warning shadow-[0_0_8px_var(--warning)]'
                          : stage.status === 'done' || stage.status === 'approved'
                            ? 'bg-gradient-to-r from-accent to-accent-2'
                            : stage.status === 'failed'
                              ? 'bg-critical'
                              : 'bg-surface-2'
                    }`}
                  />
                ))}
              </ol>
            </Link>
          )
        })}
        {!pipelines.length && (
          <div className="rounded-2xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-2">
            {filter === 'all' ? 'Конвейеров пока нет' : 'Здесь пусто'}
          </div>
        )}
      </div>
    </>
  )
}

export default PipelinesPage
