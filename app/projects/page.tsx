import { Folder } from 'lucide-react'
import Link from 'next/link'

import { Card, Empty, PageHeader } from '@/components/ui'
import { formatDateTime, formatUsd, shortPath } from '@/lib/format'
import type { SearchParams } from '@/lib/scope'
import { listAccounts } from '@/server/accounts'
import { flattenTree, projectTree, projectUsageTotals, unassignedFolders } from '@/server/projects'
import { readView, visibleAccounts, visibleProjectOptions, visibleTeams } from '@/server/visibility'

import { createProjectAction } from './actions'
import { ProjectForm } from './ProjectForm'

const ProjectsPage = async (props: { searchParams: SearchParams }) => {
  const params = await props.searchParams
  const newPath = typeof params['new'] === 'string' ? params['new'] : null
  const view = await readView()
  const nodes = flattenTree(projectTree()).filter((node) => view.allowsProject(node.id))
  const accounts = visibleAccounts(view)
  const accountNames = new Map(listAccounts().map((a) => [a.id, a.name]))
  const options = visibleProjectOptions(view)
  const folders = unassignedFolders().filter((f) => view.allowsSession(null, f.cwd))
  const usageOf = projectUsageTotals(view.hidden)
  // Suggest the nearest existing project as the parent of a new folder
  const suggestedParent = newPath
    ? nodes
        .filter((n) => n.path && newPath.startsWith(`${n.path}/`))
        .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0]?.id
    : undefined

  return (
    <>
      <PageHeader
        title="Проекты"
        description="Дерево проектов и подпроектов. Сессия попадает в проект, чьи файлы она трогала чаще всего; аккаунт наследуется от родителя."
      />

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="flex flex-col gap-4 xl:col-span-3">
          <Card title="Дерево проектов">
            {nodes.length ? (
              <ul className="flex flex-col">
                {nodes.map((node) => {
                  const u = usageOf(node.id)
                  return (
                    <li key={node.id} className="border-b border-border last:border-0">
                      <Link
                        href={`/projects/${node.id}`}
                        className="flex items-center gap-2 py-2 text-sm hover:text-accent"
                        style={{ paddingLeft: node.depth * 20 }}
                      >
                        <Folder size={15} className="shrink-0 text-text-3" aria-hidden />
                        <span className="font-medium">{node.name}</span>
                        <span className="min-w-0 truncate font-mono text-xs text-text-3">
                          {node.path ? shortPath(node.path) : 'без папки'}
                        </span>
                        <span className="tabular ml-auto shrink-0 text-xs text-text-2">
                          {u.sessions} сес. · {formatUsd(u.cost)}
                        </span>
                        <span className="hidden w-32 shrink-0 truncate text-right text-xs text-text-3 sm:inline">
                          {node.effectiveAccountId
                            ? `${accountNames.get(node.effectiveAccountId) ?? '—'}${node.accountId ? '' : ' (насл.)'}`
                            : `${accountNames.get('default') ?? 'Основная подписка'} (по умолч.)`}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Empty>Проектов пока нет. Создайте первый справа или из списка папок ниже.</Empty>
            )}
          </Card>

          <Card
            title="Папки без проекта"
            hint="Где запускались сессии, но проект не назначен. Нажмите, чтобы создать проект из папки."
          >
            {folders.length ? (
              <ul className="flex flex-col text-sm">
                {folders.map((f) => (
                  <li
                    key={f.cwd}
                    className="flex items-center gap-3 border-b border-border py-1.5 last:border-0"
                  >
                    <Link
                      href={`/projects?new=${encodeURIComponent(f.cwd)}`}
                      className="min-w-0 flex-1 truncate font-mono text-xs hover:text-accent"
                    >
                      {shortPath(f.cwd)}
                    </Link>
                    <span className="tabular shrink-0 text-xs text-text-2">{f.sessions} сес.</span>
                    <span className="tabular hidden shrink-0 text-xs text-text-3 sm:inline">
                      {formatDateTime(f.lastAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-text-3">
                Все папки разложены по проектам
              </p>
            )}
          </Card>
        </div>

        <Card
          title={newPath ? 'Новый проект из папки' : 'Новый проект'}
          className="h-fit xl:col-span-2"
        >
          <ProjectForm
            key={newPath ?? 'empty'}
            action={createProjectAction}
            submitLabel="Создать проект"
            projects={options}
            accounts={accounts}
            teams={visibleTeams(view)}
            defaults={
              newPath
                ? {
                    name: newPath.split('/').pop() ?? '',
                    path: newPath,
                    parentId: suggestedParent ?? null,
                  }
                : undefined
            }
          />
        </Card>
      </div>
    </>
  )
}

export default ProjectsPage
