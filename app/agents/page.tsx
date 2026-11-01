import { Plus } from 'lucide-react'
import Link from 'next/link'

import { Robot, type RobotState } from '@/components/Robot'
import { RoleCard } from '@/components/RoleCard'
import { Card, PageHeader } from '@/components/ui'
import { formatInt } from '@/lib/format'
import type { SearchParams } from '@/lib/scope'
import { builtinAgentUsage } from '@/server/org'
import { readView, visibleTeams } from '@/server/visibility'

const ROBOT_LEGEND: { state: RobotState; label: string }[] = [
  { state: 'idle', label: 'ждёт задачу' },
  { state: 'working', label: 'работает' },
  { state: 'waiting', label: 'ждёт вас' },
  { state: 'done', label: 'готово' },
  { state: 'error', label: 'ошибка' },
  { state: 'offline', label: 'не активен' },
]

const AgentsPage = async (props: { searchParams: SearchParams }) => {
  const params = await props.searchParams
  const query = typeof params['q'] === 'string' ? params['q'].trim().toLowerCase() : ''
  const teams = visibleTeams(await readView())
  const matches = (text: string) => text.toLowerCase().includes(query)
  const filtered = teams
    .map((team) => ({
      ...team,
      roles: query
        ? team.roles.filter((r) => matches(r.title) || matches(r.id) || matches(r.description))
        : team.roles,
    }))
    .filter((team) => team.roles.length)
  const usage = builtinAgentUsage()

  return (
    <>
      <PageHeader
        title="Агенты"
        description="Роли, из которых собираются команды. У каждой роли свой робот — по нему агента видно на задачах, конвейерах и в зале."
        actions={
          <div className="flex items-center gap-2">
            <form className="flex">
              <input
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Найти роль"
                aria-label="Найти роль"
                className="w-44 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
              />
            </form>
            <Link href="/agents/new" className="inline-flex items-center gap-1.5 btn-primary">
              <Plus size={15} aria-hidden /> Новая роль
            </Link>
          </div>
        }
      />
      <div className="grid gap-6 xl:grid-cols-4">
        <div className="flex flex-col gap-6 xl:col-span-3">
          {filtered.map((team) => (
            <section key={team.id} aria-labelledby={`team-${team.id}`}>
              <h2 id={`team-${team.id}`} className="mb-2 text-sm font-medium">
                <Link href={`/teams/${team.id}`} className="hover:text-accent">
                  {team.name}
                </Link>
                <span className="ml-2 text-xs font-normal text-text-3">{team.roles.length}</span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {team.roles.map((role) => (
                  <RoleCard key={role.id} role={role} />
                ))}
              </div>
            </section>
          ))}
          {!filtered.length && (
            <div className="rounded-2xl border border-dashed border-border-strong px-4 py-12 text-center text-sm text-text-2">
              Ничего не нашлось
            </div>
          )}
        </div>
        <div className="flex h-fit flex-col gap-4">
          <Card title="Состояния роботов" hint="Так агент показывает, что с ним происходит">
            <ul className="grid grid-cols-3 gap-3 text-center text-[11px] text-text-2">
              {ROBOT_LEGEND.map((item) => (
                <li key={item.state} className="flex flex-col items-center gap-1">
                  <Robot
                    seed={`legend-${item.state}`}
                    state={item.state}
                    size={44}
                    team="frontend"
                  />
                  {item.label}
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title="Встроенные субагенты в ваших сессиях"
            hint="Какие типы субагентов Claude Code запускал в проиндексированных сессиях"
          >
            {usage.length ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {usage.map((u) => (
                  <li key={u.agentType} className="flex justify-between gap-3">
                    <span className="truncate font-mono text-xs">{u.agentType}</span>
                    <span className="tabular text-text-2">{formatInt(u.runs)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-3">Пока не было</p>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

export default AgentsPage
