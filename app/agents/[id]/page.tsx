import { ArrowLeft, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Robot } from '@/components/Robot'
import { Card } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { getCommonRules, getRole, roleMarkdown } from '@/server/org'
import { readView, visibleRoles, visibleTeams } from '@/server/visibility'

import { deleteRoleAction, updateRoleAction } from '../actions'
import { RoleForm } from '../RoleForm'

const RolePage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const role = getRole(id)
  const view = await readView()
  if (!role || !visibleRoles(view).some((r) => r.id === role.id)) notFound()
  const teams = visibleTeams(view)
  const team = teams.find((t) => t.id === role.teamId)
  const markdown = roleMarkdown(role, team?.name ?? role.teamId, getCommonRules())

  return (
    <>
      <Link
        href={team ? `/teams/${team.id}` : '/agents'}
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> {team?.name ?? 'Агенты'}
      </Link>
      <div className="glass group mb-6 flex items-center gap-5 rounded-2xl p-5">
        <Robot seed={role.id} team={role.teamId} state="idle" size={96} label={role.title} />
        <div className="min-w-0">
          <div className="text-xs tracking-widest text-text-3 uppercase">{team?.name}</div>
          <h1 className="font-display text-gradient text-2xl font-semibold">{role.title}</h1>
          <p className="mt-1 text-sm text-text-2">{role.description}</p>
          <p className="mt-1 text-xs text-text-3">Изменено {formatDateTime(role.updatedAt)}</p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <RoleForm
            action={updateRoleAction.bind(null, role.id)}
            teams={teams}
            role={role}
            submitLabel="Сохранить роль"
          />
          <form
            action={deleteRoleAction.bind(null, role.id)}
            className="mt-4 border-t border-border pt-3"
          >
            <button
              type="submit"
              className="inline-flex items-center gap-1 text-xs text-critical hover:underline"
            >
              <Trash2 size={13} aria-hidden /> Удалить роль
            </button>
          </form>
        </Card>
        <Card
          title={`.claude/agents/${role.id}.md`}
          hint="Так роль выглядит как файл агента Claude Code — можно скопировать в любой проект"
          className="h-fit xl:col-span-2"
        >
          <pre className="max-h-[70vh] overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-2">
            {markdown}
          </pre>
        </Card>
      </div>
    </>
  )
}

export default RolePage
