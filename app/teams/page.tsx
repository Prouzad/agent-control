import { ArrowRight, Crown, Hand } from 'lucide-react'
import Link from 'next/link'

import { Robot } from '@/components/Robot'
import { TeamIcon } from '@/components/TeamIcon'
import { Card, PageHeader } from '@/components/ui'
import { PIPELINE } from '@/lib/teams'
import { getCommonRules } from '@/server/org'
import { teamProjectNames } from '@/server/projects'
import { readView, visibleTeams } from '@/server/visibility'

import { createTeamAction, saveCommonRulesAction } from './actions'

const field = 'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text'

const TeamsPage = async () => {
  const teams = visibleTeams(await readView())
  const roleCount = teams.reduce((sum, t) => sum + t.roles.length, 0)
  // Teams of a project together; teams no project claims are the shared organisation
  const projectsOf = teamProjectNames()
  const groups: { label: string; teams: typeof teams }[] = []
  for (const team of teams) {
    const label = projectsOf.get(team.id)?.join(', ') ?? 'Общая оргструктура'
    const group = groups.find((g) => g.label === label)
    if (group) group.teams.push(team)
    else groups.push({ label, teams: [team] })
  }
  groups.sort(
    (a, b) => Number(a.label === 'Общая оргструктура') - Number(b.label === 'Общая оргструктура'),
  )

  return (
    <>
      <PageHeader
        title="Команды"
        description={`${teams.length} команд, ${roleCount} ролей. Каждая роль — отдельный агент со своим промптом, моделью и инструментами.`}
      />

      <Card
        title="Конвейер задачи"
        hint="Через какие команды проходит задача; на гейтах работа ждёт вашего одобрения"
        className="mb-4"
      >
        <ol className="flex flex-wrap items-center gap-1.5 text-xs">
          {PIPELINE.map((step, index) => (
            <li key={step.label} className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
                  step.gate ? 'bg-warning/15 font-medium text-warning' : 'bg-surface-2 text-text-2'
                }`}
              >
                {step.gate && <Hand size={12} aria-hidden />}
                {step.label}
              </span>
              {index < PIPELINE.length - 1 && (
                <ArrowRight size={12} className="text-text-3" aria-hidden />
              )}
            </li>
          ))}
        </ol>
      </Card>

      {groups.map((group) => (
        <section key={group.label} className="mb-6">
          <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-text-2">
            {group.label}
            <span className="text-xs font-normal text-text-3">
              {group.teams.length} команд ·{' '}
              {group.teams.reduce((sum, t) => sum + t.roles.length, 0)} ролей
            </span>
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.teams.map((team) => {
              const lead = team.roles.find((r) => r.isLead)
              return (
                <Link
                  key={team.id}
                  href={`/teams/${team.id}`}
                  className="group glass flex flex-col gap-3 rounded-2xl p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="rounded-md bg-accent-soft p-2 text-accent">
                      <TeamIcon teamId={team.id} />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold">{team.name}</div>
                      <p className="text-xs text-text-2">{team.description}</p>
                    </div>
                  </div>
                  {lead && (
                    <div className="flex items-center gap-1.5 text-xs text-text-2">
                      <Crown size={13} className="text-warning" aria-hidden />
                      Лид: {lead.title}
                    </div>
                  )}
                  <ul className="flex flex-wrap items-end gap-1" aria-label="Состав">
                    {team.roles.map((role) => (
                      <li key={role.id} title={role.title} className="flex flex-col items-center">
                        <Robot seed={role.id} team={team.id} size={role.isLead ? 40 : 32} />
                      </li>
                    ))}
                    {!team.roles.length && <li className="text-xs text-text-3">Ролей пока нет</li>}
                  </ul>
                  <p className="text-xs text-text-3">
                    {team.roles.map((r) => r.title).join(' · ')}
                  </p>
                </Link>
              )
            })}
          </div>
        </section>
      ))}

      <div className="grid gap-4 xl:grid-cols-5">
        <Card
          title="Общие правила для всех агентов"
          hint="Добавляются в конец промпта каждой роли"
          className="xl:col-span-3"
        >
          <form action={saveCommonRulesAction} className="flex flex-col gap-3">
            <textarea
              name="rules"
              defaultValue={getCommonRules()}
              rows={9}
              aria-label="Общие правила"
              className={`${field} font-mono text-xs leading-relaxed`}
            />
            <button type="submit" className="w-fit btn-primary">
              Сохранить правила
            </button>
          </form>
        </Card>
        <Card title="Новая команда" className="h-fit xl:col-span-2">
          <form action={createTeamAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-2">
              Название
              <input name="name" required className={field} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-2">
              Чем занимается
              <input name="description" className={field} />
            </label>
            <button type="submit" className="w-fit btn-primary">
              Создать команду
            </button>
          </form>
        </Card>
      </div>
    </>
  )
}

export default TeamsPage
