import Link from 'next/link'

import {
  formatDateTime,
  formatDuration,
  formatInt,
  formatUsd,
  modelLabel,
  shortPath,
} from '@/lib/format'
import type { SessionRow } from '@/server/queries'

import { Empty } from './ui'

type Props = { sessions: SessionRow[]; projectNames: Map<string, string> }

export const SessionsTable = (props: Props) => {
  if (!props.sessions.length) return <Empty>Сессий за период нет</Empty>
  return (
    <div className="overflow-x-auto glass rounded-2xl">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-border text-left text-xs text-text-3">
          <tr>
            <th className="px-3 py-2 font-medium">Сессия</th>
            <th className="px-3 py-2 font-medium">Проект</th>
            <th className="px-3 py-2 font-medium">Последняя активность</th>
            <th className="px-3 py-2 font-medium">Длительность</th>
            <th className="px-3 py-2 font-medium">Модель</th>
            <th className="px-3 py-2 text-right font-medium">Инструменты</th>
            <th className="px-3 py-2 text-right font-medium">Субагенты</th>
            <th className="px-3 py-2 text-right font-medium">Стоимость</th>
          </tr>
        </thead>
        <tbody>
          {props.sessions.map((s) => (
            <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface-2">
              <td className="max-w-80 px-3 py-2">
                <Link
                  href={`/sessions/${s.id}`}
                  className="block truncate font-medium hover:text-accent"
                >
                  {s.title ?? s.firstPrompt ?? s.id.slice(0, 8)}
                </Link>
                <div className="truncate text-xs text-text-3">{shortPath(s.cwd)}</div>
              </td>
              <td className="px-3 py-2 text-text-2">
                {s.projectId ? (
                  (props.projectNames.get(s.projectId) ?? '—')
                ) : (
                  <span className="text-text-3">—</span>
                )}
              </td>
              <td className="tabular px-3 py-2 whitespace-nowrap text-text-2">
                {formatDateTime(s.endedAt)}
              </td>
              <td className="tabular px-3 py-2 whitespace-nowrap text-text-2">
                {formatDuration(s.startedAt, s.endedAt)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-text-2">
                {s.model ? modelLabel(s.model) : '—'}
              </td>
              <td className="tabular px-3 py-2 text-right text-text-2">{formatInt(s.toolCalls)}</td>
              <td className="tabular px-3 py-2 text-right text-text-2">{formatInt(s.subagents)}</td>
              <td className="tabular px-3 py-2 text-right font-medium">{formatUsd(s.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
