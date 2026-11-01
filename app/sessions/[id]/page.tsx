import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BarList, Card, PageHeader, StatTile } from '@/components/ui'
import {
  formatCompact,
  formatDateTime,
  formatDuration,
  formatInt,
  formatTime,
  formatUsd,
  modelLabel,
  shortPath,
} from '@/lib/format'
import { projectNames, sessionTouchedProjects } from '@/server/projects'
import { getSession, sessionByModel, sessionSubagents, sessionToolCalls } from '@/server/queries'
import { readView } from '@/server/visibility'

const TIMELINE_LIMIT = 400

const SessionPage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const session = getSession(id)
  if (!session || !(await readView()).allowsSession(session.projectId, session.cwd)) notFound()

  const tools = sessionToolCalls(id)
  const subagents = sessionSubagents(id)
  const models = sessionByModel(id)
  const agentNames = new Map(subagents.map((a) => [a.id, a.agentType ?? 'субагент']))
  const toolCounts = [...Map.groupBy(tools, (t) => t.name)].map(([name, calls]) => ({
    name,
    calls: calls.length,
  }))
  toolCounts.sort((a, b) => b.calls - a.calls)
  const projectName = session.projectId ? projectNames().get(session.projectId) : undefined
  const errors = tools.filter((t) => t.isError).length
  const touched = sessionTouchedProjects(id)

  return (
    <>
      <Link
        href="/sessions"
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> Сессии
      </Link>
      <PageHeader
        title={session.title ?? session.firstPrompt?.slice(0, 80) ?? session.id}
        description={`${projectName ?? 'Без проекта'} · ${shortPath(session.cwd)}${session.gitBranch ? ` · ${session.gitBranch}` : ''}`}
      />
      {touched.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-text-2">
          <span className="text-text-3">Затронутые проекты:</span>
          {touched.map((p) => (
            <span key={p.projectId} className="rounded-full bg-surface-2 px-2 py-0.5">
              {p.name} <span className="tabular text-text-3">· {p.touches}</span>
            </span>
          ))}
        </div>
      )}
      {session.firstPrompt && (
        <blockquote className="mb-4 rounded-lg border-l-2 border-accent bg-surface px-4 py-3 text-sm whitespace-pre-wrap text-text-2">
          {session.firstPrompt}
        </blockquote>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Стоимость (экв. API)" value={formatUsd(session.costUsd)} />
        <StatTile
          label="Длительность"
          value={formatDuration(session.startedAt, session.endedAt)}
          sub={`${formatDateTime(session.startedAt)} → ${formatDateTime(session.endedAt)}`}
        />
        <StatTile
          label="Инструменты"
          value={formatInt(tools.length)}
          sub={errors ? `${errors} с ошибкой` : 'без ошибок'}
        />
        <StatTile label="Субагенты" value={formatInt(subagents.length)} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Модели">
          <BarList
            items={models.map((m) => ({
              key: m.model,
              label: modelLabel(m.model),
              value: m.costUsd,
              display: formatUsd(m.costUsd),
              sub: `${formatCompact(m.outputTokens)} вывод`,
            }))}
          />
        </Card>
        <Card title="Инструменты">
          <BarList
            items={toolCounts.slice(0, 8).map((t) => ({
              key: t.name,
              label: t.name,
              value: t.calls,
              display: formatInt(t.calls),
            }))}
          />
        </Card>
        <Card title="Субагенты">
          {subagents.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {subagents.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate">{a.description ?? a.id}</div>
                    <div className="text-xs text-text-3">
                      {a.agentType ?? 'субагент'} · {formatInt(a.toolCalls)} инстр.
                    </div>
                  </div>
                  <span className="tabular shrink-0 text-text-2">{formatUsd(a.costUsd)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-text-3">Субагентов не было</p>
          )}
        </Card>
      </div>
      <Card
        title="Хронология инструментов"
        hint={
          tools.length > TIMELINE_LIMIT
            ? `Последние ${TIMELINE_LIMIT} из ${tools.length}`
            : undefined
        }
      >
        <ol className="flex flex-col text-sm">
          {tools.slice(-TIMELINE_LIMIT).map((t) => (
            <li key={t.id} className="flex gap-3 border-b border-border py-1.5 last:border-0">
              <span className="tabular w-16 shrink-0 text-xs text-text-3">{formatTime(t.ts)}</span>
              <span className="w-32 shrink-0 truncate font-mono text-xs">{t.name}</span>
              <span className="min-w-0 flex-1 truncate text-text-2">{t.summary ?? ''}</span>
              {t.agentId && (
                <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 text-xs text-text-2 sm:inline">
                  {agentNames.get(t.agentId) ?? 'субагент'}
                </span>
              )}
              {t.isError && (
                <span className="shrink-0 rounded bg-critical/15 px-1.5 text-xs text-critical">
                  ошибка
                </span>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </>
  )
}

export default SessionPage
