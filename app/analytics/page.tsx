import { DailyCostChart } from '@/components/DailyCostChart'
import { FilterBar } from '@/components/FilterBar'
import { BarList, Card, PageHeader } from '@/components/ui'
import { formatCompact, formatInt, formatPercent, formatUsd, modelLabel } from '@/lib/format'
import { PERIODS, readScope, type SearchParams } from '@/lib/scope'
import { dailyCost } from '@/server/daily'
import { projectNames } from '@/server/projects'
import { visibleProjectOptions } from '@/server/visibility'
import { byModel, byProject, bySubagentType, topTools } from '@/server/queries'

const AnalyticsPage = async (props: { searchParams: SearchParams }) => {
  const { scope, period, project, view } = await readScope(props.searchParams)
  const models = byModel(scope)
  const names = projectNames()

  return (
    <>
      <PageHeader
        title="Аналитика"
        description="Токены и стоимость в разрезе моделей, проектов, инструментов и типов субагентов"
        actions={
          <FilterBar
            periods={[...PERIODS]}
            period={period}
            projects={visibleProjectOptions(view)}
            project={project}
          />
        }
      />
      <Card
        title="Стоимость по дням"
        hint="По семействам моделей, эквивалент цен API"
        className="mb-4"
      >
        <DailyCostChart data={dailyCost(scope)} height={260} />
      </Card>

      <Card
        title="Модели"
        hint="Токены по видам: ввод, запись и чтение кэша, вывод"
        className="mb-4"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs text-text-3">
              <tr>
                <th className="py-2 pr-3 font-medium">Модель</th>
                <th className="px-3 py-2 text-right font-medium">Ответов</th>
                <th className="px-3 py-2 text-right font-medium">Ввод</th>
                <th className="px-3 py-2 text-right font-medium">Запись кэша</th>
                <th className="px-3 py-2 text-right font-medium">Чтение кэша</th>
                <th className="px-3 py-2 text-right font-medium">Вывод</th>
                <th className="px-3 py-2 text-right font-medium">Попадание</th>
                <th className="py-2 pl-3 text-right font-medium">Стоимость</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {models.map((m) => {
                const prompt = m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens
                return (
                  <tr key={m.model} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{modelLabel(m.model)}</div>
                      <div className="text-xs text-text-3">{m.model}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-text-2">{formatInt(m.messages)}</td>
                    <td className="px-3 py-2 text-right text-text-2">
                      {formatCompact(m.inputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-2">
                      {formatCompact(m.cacheWriteTokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-2">
                      {formatCompact(m.cacheReadTokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-2">
                      {formatCompact(m.outputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-2">
                      {formatPercent(prompt ? m.cacheReadTokens / prompt : 0)}
                    </td>
                    <td className="py-2 pl-3 text-right font-medium">{formatUsd(m.costUsd)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!models.length && (
            <p className="py-6 text-center text-sm text-text-3">Нет данных за период</p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Проекты">
          <BarList
            items={byProject(scope).map((p) => ({
              key: p.projectId ?? 'none',
              label: p.projectId ? (names.get(p.projectId) ?? '—') : 'Без проекта',
              value: p.costUsd,
              display: formatUsd(p.costUsd),
              sub: `${p.sessions} сес.`,
            }))}
          />
        </Card>
        <Card title="Инструменты" hint="Вызовы и доля ошибок">
          <BarList
            items={topTools(scope).map((t) => ({
              key: t.name,
              label: t.name,
              value: t.calls,
              display: formatInt(t.calls),
              sub: t.errors ? `${formatPercent(t.errors / t.calls)} ош.` : undefined,
            }))}
          />
        </Card>
        <Card title="Типы субагентов" hint="Запуски и стоимость">
          <BarList
            items={bySubagentType(scope).map((a) => ({
              key: a.agentType,
              label: a.agentType,
              value: a.costUsd,
              display: formatUsd(a.costUsd),
              sub: `${a.runs} зап.`,
            }))}
          />
        </Card>
      </div>
    </>
  )
}

export default AnalyticsPage
