import { Coins, Sparkles, Wrench, Zap } from 'lucide-react'
import Link from 'next/link'

import { Crew } from '@/components/Crew'
import { DailyCostChart } from '@/components/DailyCostChart'
import { FilterBar } from '@/components/FilterBar'
import { SessionsTable } from '@/components/SessionsTable'
import { BarList, Card, PageHeader, StatTile } from '@/components/ui'
import { formatCompact, formatInt, formatUsd } from '@/lib/format'
import { PERIODS, readScope, type SearchParams } from '@/lib/scope'
import { dailyCost } from '@/server/daily'
import { projectNames } from '@/server/projects'
import { visibleProjectOptions } from '@/server/visibility'
import { byProject, listSessions, totals } from '@/server/queries'

const OverviewPage = async (props: { searchParams: SearchParams }) => {
  const { scope, period, project, view } = await readScope(props.searchParams)
  const t = totals(scope)
  const names = projectNames()
  const promptTokens = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens
  const cacheHit = promptTokens ? t.cacheReadTokens / promptTokens : 0
  const projects = byProject(scope).slice(0, 8)

  return (
    <>
      <PageHeader
        title="Обзор"
        description="Сессии Claude Code с этой машины. Стоимость — эквивалент цен API, на подписке не списывается."
        actions={
          <FilterBar
            periods={[...PERIODS]}
            period={period}
            projects={visibleProjectOptions(view)}
            project={project}
          />
        }
      />
      <Crew />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Стоимость (экв. API)"
          count={t.costUsd}
          format="usd"
          icon={<Coins size={16} aria-hidden />}
          sub={`${formatInt(t.sessions)} сессий`}
        />
        <StatTile
          label="Токены вывода"
          count={t.outputTokens}
          format="compact"
          icon={<Sparkles size={16} aria-hidden />}
          sub={`ввод ${formatCompact(promptTokens)}`}
        />
        <StatTile
          label="Попадание в кэш"
          count={cacheHit}
          format="percent"
          icon={<Zap size={16} aria-hidden />}
          sub="доля чтения из кэша во вводе"
        />
        <StatTile
          label="Вызовы инструментов"
          count={t.toolCalls}
          format="compact"
          icon={<Wrench size={16} aria-hidden />}
          sub={`${formatInt(t.toolErrors)} с ошибкой · ${formatInt(t.subagents)} субагентов`}
        />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Стоимость по дням" hint="По семействам моделей" className="lg:col-span-2">
          <DailyCostChart data={dailyCost(scope)} />
        </Card>
        <Card title="Проекты" hint="По стоимости за период">
          <BarList
            items={projects.map((p) => ({
              key: p.projectId ?? 'none',
              label: p.projectId ? (names.get(p.projectId) ?? '—') : 'Без проекта',
              value: p.costUsd,
              display: formatUsd(p.costUsd),
              sub: `${p.sessions} сес.`,
            }))}
          />
          {projects.some((p) => !p.projectId) && (
            <Link href="/projects" className="mt-3 block text-xs text-accent hover:underline">
              Разложить папки по проектам →
            </Link>
          )}
        </Card>
      </div>
      <Card title="Последние сессии">
        <SessionsTable sessions={listSessions(scope, 10)} projectNames={names} />
        <Link href="/sessions" className="mt-3 block text-xs text-accent hover:underline">
          Все сессии →
        </Link>
      </Card>
    </>
  )
}

export default OverviewPage
