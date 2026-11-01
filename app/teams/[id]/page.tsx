import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { RoleCard } from '@/components/RoleCard'
import { TeamIcon } from '@/components/TeamIcon'
import { Card, PageHeader } from '@/components/ui'
import { getTeam } from '@/server/org'
import { readView, visibleTeams } from '@/server/visibility'

import { deleteTeamAction, updateTeamAction } from '../actions'

const field = 'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text'

const TeamPage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const team = getTeam(id)
  if (!team || !visibleTeams(await readView()).some((t) => t.id === team.id)) notFound()

  return (
    <>
      <Link
        href="/teams"
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> Команды
      </Link>
      <PageHeader
        title={team.name}
        description={team.description}
        actions={
          <Link
            href={`/agents/new?team=${team.id}`}
            className="inline-flex items-center gap-1.5 btn-primary"
          >
            <Plus size={15} aria-hidden /> Добавить роль
          </Link>
        }
      />
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          {team.roles.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {team.roles.map((role) => (
                <RoleCard key={role.id} role={role} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border-strong px-4 py-12 text-center text-sm text-text-2">
              В команде пока нет ролей
            </div>
          )}
        </div>
        <Card title="Команда" className="h-fit">
          <div className="mb-3 flex items-center gap-2 text-text-2">
            <TeamIcon teamId={team.id} />
            <span className="text-xs">{team.roles.length} ролей</span>
          </div>
          <form action={updateTeamAction.bind(null, team.id)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-2">
              Название
              <input name="name" required defaultValue={team.name} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-2">
              Чем занимается
              <textarea
                name="description"
                rows={3}
                defaultValue={team.description}
                className={field}
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="delegate"
                defaultChecked={team.delegate}
                className="mt-0.5 accent-accent"
              />
              <span>
                Лид раздаёт работу команде
                <span className="block text-xs text-text-3">
                  Остальные роли команды становятся его субагентами: лид сам решает, кого позвать
                </span>
              </span>
            </label>
            <button
              type="submit"
              className="w-fit rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
            >
              Сохранить
            </button>
          </form>
          {!team.roles.length && (
            <form action={deleteTeamAction.bind(null, team.id)} className="mt-3">
              <button
                type="submit"
                className="inline-flex items-center gap-1 text-xs text-critical hover:underline"
              >
                <Trash2 size={13} aria-hidden /> Удалить команду
              </button>
            </form>
          )}
        </Card>
      </div>
    </>
  )
}

export default TeamPage
