import { ArrowLeft, Folder, Settings } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SessionsTable } from '@/components/SessionsTable'
import { Card, Empty, PageHeader, StatTile } from '@/components/ui'
import { formatDateTime, formatUsd, shortPath } from '@/lib/format'
import { PIPELINE_CLASS, PIPELINE_LABEL } from '@/lib/pipelineStatus'
import { STATUS_CLASS, STATUS_LABEL } from '@/lib/taskStatus'
import { listPipelines } from '@/server/pipelines'
import {
  effectiveAccountId,
  effectiveTeamIds,
  getProject,
  ownTeamIds,
  listProjects,
  projectNames,
  projectUsageTotals,
  projectWithDescendants,
} from '@/server/projects'
import { listSessions, totals } from '@/server/queries'
import { listTasks } from '@/server/tasks'
import { readView, visibleAccounts, visibleTeams } from '@/server/visibility'

const ProjectPage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const project = getProject(id)
  const view = await readView()
  if (!project || !view.allowsProject(id)) notFound()
  const all = listProjects()
  const parent = project.parentId ? all.find((p) => p.id === project.parentId) : undefined
  const children = all.filter((p) => p.parentId === id && view.allowsProject(p.id))
  // Everything below counts towards this project: its own sessions and those of its visible
  // sub-projects
  const ids = projectWithDescendants(id).filter((pid) => view.allowsProject(pid))
  const scope = { since: null, projectIds: ids }
  const sum = totals(scope)
  const sessions = listSessions(scope, 50)
  const childUsage = projectUsageTotals(view.hidden)
  const inProject = new Set(ids)
  const tasks = listTasks()
    .filter((t) => t.projectId && inProject.has(t.projectId) && !t.pipelineId)
    .slice(0, 20)
  const pipelines = listPipelines()
    .filter((p) => p.projectId && inProject.has(p.projectId))
    .slice(0, 20)
  const accounts = visibleAccounts(view)
  const teams = visibleTeams(view)
  const own = ownTeamIds(id)
  const projectTeams = effectiveTeamIds(id).flatMap((tid) => teams.find((t) => t.id === tid) ?? [])
  const account = accounts.find((a) => a.id === effectiveAccountId(id))

  return (
    <>
      <Link
        href={parent ? `/projects/${parent.id}` : '/projects'}
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> {parent ? parent.name : 'Проекты'}
      </Link>
      <PageHeader
        title={project.name}
        description={`${project.path ? shortPath(project.path) : 'Без папки — объединяет подпроекты'} · аккаунт: ${account?.name ?? '—'}${project.accountId ? '' : ' (наследуется)'}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Сессии" count={sum.sessions} format="int" />
        <StatTile label="Стоимость" count={sum.costUsd} format="usd" sub="за всё время" />
        <StatTile
          label="Токены"
          count={sum.inputTokens + sum.outputTokens + sum.cacheReadTokens + sum.cacheWriteTokens}
          format="compact"
        />
        <StatTile label="Подпроекты" count={children.length} format="int" />
      </div>

      {!project.path && !children.length && (
        <div className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-text-2">
          У проекта нет папки и подпроектов, поэтому сессии в него не попадают. Укажите папку в
          настройках ниже или добавьте подпроект с папкой.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          {children.length > 0 && (
            <Card title="Подпроекты">
              <ul className="flex flex-col">
                {children.map((child) => {
                  const u = childUsage(child.id)
                  return (
                    <li key={child.id} className="border-b border-border last:border-0">
                      <Link
                        href={`/projects/${child.id}`}
                        className="flex items-center gap-2 py-2 text-sm hover:text-accent"
                      >
                        <Folder size={15} className="shrink-0 text-text-3" aria-hidden />
                        <span className="font-medium">{child.name}</span>
                        <span className="min-w-0 truncate font-mono text-xs text-text-3">
                          {shortPath(child.path)}
                        </span>
                        <span className="tabular ml-auto shrink-0 text-xs text-text-2">
                          {u.sessions} сес. · {formatUsd(u.cost)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          <Card
            title="Сессии"
            hint={sessions.length ? 'Последние 50, включая подпроекты' : undefined}
          >
            {sessions.length ? (
              <SessionsTable sessions={sessions} projectNames={projectNames()} />
            ) : (
              <Empty>Сессий пока нет</Empty>
            )}
          </Card>

          {(pipelines.length > 0 || tasks.length > 0) && (
            <Card title="Конвейеры и задачи">
              <ul className="flex flex-col text-sm">
                {pipelines.map((p) => (
                  <li key={p.id} className="border-b border-border last:border-0">
                    <Link
                      href={`/pipelines/${p.id}`}
                      className="flex items-center gap-2 py-2 hover:text-accent"
                    >
                      <span className="min-w-0 flex-1 truncate">Конвейер: {p.title}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${PIPELINE_CLASS[p.status]}`}
                      >
                        {PIPELINE_LABEL[p.status]}
                      </span>
                    </Link>
                  </li>
                ))}
                {tasks.map((t) => (
                  <li key={t.id} className="border-b border-border last:border-0">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="flex items-center gap-2 py-2 hover:text-accent"
                    >
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="hidden shrink-0 text-xs text-text-3 sm:inline">
                        {formatDateTime(t.createdAt)}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[t.status]}`}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card
            title="Команды"
            hint={
              projectTeams.length
                ? own.length
                  ? 'Их роли берут этапы конвейеров проекта'
                  : 'Наследуются от родительского проекта'
                : undefined
            }
          >
            {projectTeams.length ? (
              <ul className="flex flex-col text-sm">
                {projectTeams.map((team) => (
                  <li key={team.id} className="border-b border-border last:border-0">
                    <Link
                      href={`/teams/${team.id}`}
                      className="flex items-center gap-2 py-2 hover:text-accent"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{team.name}</span>
                      <span className="shrink-0 text-xs text-text-2">
                        {team.roles.length} ролей
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Команды не выбраны — конвейеры берут общие роли</Empty>
            )}
          </Card>
          <Link
            href={`/settings/projects/${id}`}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-2 hover:text-text"
          >
            <Settings size={14} aria-hidden /> Настройки проекта
          </Link>
        </div>
      </div>
    </>
  )
}

export default ProjectPage
