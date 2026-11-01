import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, PageHeader } from '@/components/ui'
import { shortPath } from '@/lib/format'
import { listAccounts } from '@/server/accounts'
import { listTeams } from '@/server/org'
import {
  effectiveTeamIds,
  getProject,
  listProjects,
  ownTeamIds,
  projectOptions,
  projectWithDescendants,
} from '@/server/projects'
import { readView, visibleAccounts, visibleTeams } from '@/server/visibility'

import { deleteProjectAction, updateProjectAction } from '../../../projects/actions'
import { ProjectForm } from '../../../projects/ProjectForm'
import { setProjectHiddenAction } from '../../actions'

// Project settings live under Settings, so a hidden project can still be reached and shown again
const ProjectSettingsPage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const project = getProject(id)
  if (!project) notFound()
  const view = await readView()
  const all = listProjects()
  const own = ownTeamIds(id)
  const effective = effectiveTeamIds(id)
  const allTeams = listTeams()
  // Other hidden projects stay out of sight here too; this project's own choices are always shown
  const shownTeams = visibleTeams(view)
  const teams = allTeams.filter(
    (team) => shownTeams.some((t) => t.id === team.id) || effective.includes(team.id),
  )
  const shownAccounts = new Set(visibleAccounts(view).map((a) => a.id))
  const accounts = listAccounts().filter(
    (a) => shownAccounts.has(a.id) || a.id === project.accountId,
  )
  const subtree = new Set(projectWithDescendants(id))
  const parents = projectOptions().filter(
    (o) => !subtree.has(o.id) && (!view.hidden.has(o.id) || o.id === project.parentId),
  )
  const hiddenByParent = !project.hidden && view.hidden.has(id)
  const parentHidden = hiddenByParent
    ? all.find((p) => p.hidden && projectWithDescendants(p.id).includes(id))
    : undefined
  const shown = !view.hidden.has(id)

  return (
    <>
      <Link
        href="/settings"
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> Настройки
      </Link>
      <PageHeader
        title={project.name}
        description={project.path ? shortPath(project.path) : 'Без папки — объединяет подпроекты'}
        actions={
          shown ? (
            <Link
              href={`/projects/${id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-2 hover:text-text"
            >
              <ExternalLink size={14} aria-hidden /> Открыть проект
            </Link>
          ) : undefined
        }
      />

      <div className="flex max-w-3xl flex-col gap-4">
        <Card title="Проект">
          <ProjectForm
            action={updateProjectAction.bind(null, id)}
            submitLabel="Сохранить"
            projects={parents}
            accounts={accounts}
            teams={teams}
            inheritedTeams={
              own.length
                ? undefined
                : effective.flatMap((tid) => allTeams.find((t) => t.id === tid)?.name ?? [])
            }
            defaults={{ ...project, teamIds: own }}
          />
        </Card>

        <Card
          title="Видимость"
          hint="Скрытый проект и всё, что с ним связано, пропадает из дашборда: сессии, задачи, конвейеры, суммы, команды и аккаунты только этого проекта. Агенты при этом продолжают работать"
        >
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">Показывать в дашборде</div>
              <div className="text-xs text-text-3">
                {hiddenByParent
                  ? `Скрыт вместе с родителем «${parentHidden?.name ?? '—'}» — включите его`
                  : shown
                    ? 'Проект и его подпроекты видны везде'
                    : 'Проект и его подпроекты скрыты везде, кроме этой страницы'}
              </div>
            </div>
            <form action={setProjectHiddenAction.bind(null, id, !project.hidden)}>
              <button
                type="submit"
                role="switch"
                aria-checked={shown}
                aria-label="Показывать в дашборде"
                disabled={hiddenByParent}
                className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${shown ? 'bg-accent' : 'bg-surface-2 ring-1 ring-border'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${shown ? 'translate-x-5' : ''}`}
                  aria-hidden
                />
              </button>
            </form>
          </div>
        </Card>

        <form action={deleteProjectAction.bind(null, id)}>
          <button
            type="submit"
            className="inline-flex items-center gap-1 text-xs text-critical hover:underline"
          >
            <Trash2 size={13} aria-hidden /> Удалить проект вместе с подпроектами
          </button>
        </form>
      </div>
    </>
  )
}

export default ProjectSettingsPage
