import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Info,
  ShieldAlert,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { Collapsible } from '@/components/Collapsible'
import { LiveRefresh } from '@/components/LiveRefresh'
import { StageResult } from '@/components/StageResult'
import { Card, PageHeader } from '@/components/ui'
import { formatDateTime, formatTokens, formatUsd } from '@/lib/format'
import { PIPELINE_LABEL, STAGE_LABEL } from '@/lib/pipelineStatus'
import { branchStats } from '@/server/git'
import { getPipeline, pipelineMessages } from '@/server/pipelines'
import {
  readReport,
  reportAuto,
  stageFacts,
  type CheckResult,
  type Severity,
} from '@/server/report'
import { listTasks } from '@/server/tasks'
import { readView } from '@/server/visibility'

import { RefreshReport, ReportAutoSwitch } from './RefreshReport'

// Stage chips: the status colour plus its label in the tooltip, never colour alone
const STAGE_CHIP: Record<string, string> = {
  done: 'bg-good/15 text-good',
  approved: 'bg-good/15 text-good',
  running: 'bg-accent-soft text-accent',
  waiting: 'bg-warning/15 text-warning',
  failed: 'bg-critical/15 text-critical',
}

const duration = (ms: number) => {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return '<1 мин'
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  return `${hours} ч ${minutes % 60} мин`
}

const CHECK: Record<CheckResult, { icon: ReactNode; label: string; className: string }> = {
  ok: {
    icon: <CheckCircle2 size={15} aria-hidden />,
    label: 'проверено, в порядке',
    className: 'text-good',
  },
  issue: {
    icon: <AlertTriangle size={15} aria-hidden />,
    label: 'найдены проблемы',
    className: 'text-warning',
  },
  not_checked: {
    icon: <CircleDashed size={15} aria-hidden />,
    label: 'не проверено',
    className: 'text-text-3',
  },
}

const SEVERITY: Record<Severity, { icon: ReactNode; label: string; className: string }> = {
  blocker: {
    icon: <AlertOctagon size={13} aria-hidden />,
    label: 'Блокер',
    className: 'bg-critical/15 text-critical',
  },
  major: {
    icon: <AlertTriangle size={13} aria-hidden />,
    label: 'Важно',
    className: 'bg-warning/15 text-warning',
  },
  minor: {
    icon: <Info size={13} aria-hidden />,
    label: 'Мелочь',
    className: 'bg-surface-2 text-text-2',
  },
}

// One number per tile: the label on top, the figure at the bottom
const Tile = (props: { label: string; value: string; hint?: string }) => (
  <div className="glass flex min-h-24 flex-col justify-between rounded-2xl p-4">
    <div className="text-xs text-text-3">{props.label}</div>
    <div>
      <div className="font-display text-2xl font-semibold tabular text-text">{props.value}</div>
      {props.hint && <div className="text-xs text-text-3">{props.hint}</div>}
    </div>
  </div>
)

// A single-series bar list: stage on the left, the bar, the value at its end
const Bars = (props: { rows: { label: string; value: number; text: string }[] }) => {
  const max = Math.max(...props.rows.map((r) => r.value), 0)
  return (
    <ul className="flex flex-col gap-1.5">
      {props.rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2 text-xs"
        >
          <span className="truncate text-text-2" title={row.label}>
            {row.label}
          </span>
          <span
            className="h-2 overflow-hidden rounded-full bg-surface-2"
            title={`${row.label}: ${row.text}`}
          >
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: max ? `${Math.max(2, (row.value / max) * 100)}%` : 0 }}
            />
          </span>
          <span className="tabular text-text">{row.text}</span>
        </li>
      ))}
    </ul>
  )
}

const List = (props: { items: string[]; empty: string }) =>
  props.items.length ? (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
      {props.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-text-3">{props.empty}</p>
  )

const ReportPage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const pipeline = getPipeline(id)
  if (!pipeline || !(await readView()).allowsProject(pipeline.projectId)) notFound()

  const facts = stageFacts(id)
  const agents = facts.filter((f) => f.kind === 'agent' && f.runs > 0)
  const costUsd = facts.reduce((sum, f) => sum + f.costUsd, 0)
  const tokens = facts.reduce((sum, f) => sum + f.tokens, 0)
  const workMs = facts.reduce((sum, f) => sum + f.ms, 0)
  const rework = facts.reduce((sum, f) => sum + f.attempts, 0)
  const doneStages = facts.filter((f) => ['done', 'approved', 'skipped'].includes(f.status)).length
  const branch =
    pipeline.worktreePath && pipeline.baseCommit
      ? await branchStats(pipeline.worktreePath, pipeline.baseCommit).catch(() => null)
      : null
  const { report, at } = readReport(id)
  const chatCount = pipelineMessages(id).length
  const taskIds = listTasks()
    .filter((t) => t.pipelineId === id)
    .map((t) => t.id)
  const priciest = [...agents].sort((a, b) => b.costUsd - a.costUsd)[0]
  const current = facts.find((f) => !['done', 'approved', 'skipped'].includes(f.status))
  const checksOk = report?.checked.filter((c) => c.result === 'ok').length ?? 0
  const checksIssue = report?.checked.filter((c) => c.result === 'issue').length ?? 0
  const blockerCount = report
    ? Math.max(
        report.blockers.length,
        report.problems.filter((p) => p.severity === 'blocker').length,
      )
    : 0

  return (
    <>
      <LiveRefresh pipelineId={id} taskIds={taskIds} />
      <Link
        href={`/pipelines/${id}`}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> К конвейеру
      </Link>
      <PageHeader
        title={`Отчёт: ${pipeline.title}`}
        description={`${PIPELINE_LABEL[pipeline.status]}${pipeline.note ? ` · ${pipeline.note}` : ''}`}
        actions={
          <div className="flex flex-col items-end gap-2">
            <RefreshReport pipelineId={id} hasReport={Boolean(report)} />
            <ReportAutoSwitch pipelineId={id} on={reportAuto(id)} />
          </div>
        }
      />

      <Card title="Сейчас" className="mb-4">
        <p className="text-sm text-text">
          {current ? (
            <>
              <span className="font-medium">{current.label}</span>
              {' — '}
              {STAGE_LABEL[current.status as keyof typeof STAGE_LABEL] ?? current.status}
              {current.role ? ` · ${current.role}` : ''}
            </>
          ) : (
            'Все этапы пройдены'
          )}
          {pipeline.note && !(current && pipeline.note.startsWith(current.label)) ? (
            <span className="text-text-2"> · {pipeline.note}</span>
          ) : null}
        </p>
        {/* Where the pipeline is: every stage in order, the current one outlined */}
        <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Этапы">
          {facts.map((f) => (
            <li
              key={f.id}
              className={`rounded-full px-2.5 py-1 ${STAGE_CHIP[f.status] ?? 'bg-surface-2 text-text-3'} ${
                f.id === current?.id ? 'ring-1 ring-accent' : ''
              }`}
              title={STAGE_LABEL[f.status as keyof typeof STAGE_LABEL] ?? f.status}
            >
              {f.label}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-text-3">
          <span className="text-good">●</span> пройден · <span className="text-accent">●</span> идёт
          · <span className="text-warning">●</span> ждёт решения ·{' '}
          <span className="text-critical">●</span> ошибка · <span className="text-text-3">●</span>{' '}
          впереди
        </p>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Этапов пройдено" value={`${doneStages} из ${facts.length}`} />
        <Tile
          label="Проверок пройдено"
          value={report ? `${checksOk} из ${report.checked.length}` : '—'}
          hint={report && checksIssue ? `с проблемами: ${checksIssue}` : undefined}
        />
        <Tile
          label="Проблем"
          value={report ? String(report.problems.length) : '—'}
          hint={report ? `блокеров: ${blockerCount}` : undefined}
        />
        <Tile label="Кругов доработки" value={String(rework)} />
        <Tile
          label="Изменено файлов"
          value={branch ? String(branch.files) : '—'}
          hint={branch ? `+${branch.insertions} / −${branch.deletions} строк` : undefined}
        />
        <Tile
          label="Коммитов"
          value={branch ? String(branch.commits) : '—'}
          hint={pipeline.branch ?? undefined}
        />
        <Tile label="Решений принято" value={report ? String(report.decisions.length) : '—'} />
        <Tile label="Сообщений в чате" value={String(chatCount)} />
      </div>

      {report ? (
        <>
          <Card
            title="Коротко"
            hint={at ? `Собран ${formatDateTime(at)}` : undefined}
            className="mb-4"
          >
            <p className="text-sm leading-relaxed text-text">{report.summary}</p>
          </Card>

          {(report.blockers.length > 0 ||
            report.problems.some((p) => p.severity === 'blocker')) && (
            <Card title="Блокеры" hint="Что мешает закончить и кто это снимает" className="mb-4">
              <ul className="flex flex-col gap-2">
                {report.blockers.map((b) => (
                  <li key={b.text} className="flex items-start gap-2 text-sm">
                    <ShieldAlert size={15} className="mt-0.5 shrink-0 text-critical" aria-hidden />
                    <span className="text-text">
                      {b.text}
                      {b.who && (
                        <span className="ml-1.5 text-xs text-text-3">— снимает: {b.who}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <Card title="Что сделано">
              <List items={report.done} empty="Нет данных" />
            </Card>
            <Card title="Что проверили">
              {report.checked.length ? (
                <ul className="flex flex-col gap-2">
                  {report.checked.map((c) => (
                    <li key={c.what} className="flex items-start gap-2 text-sm">
                      <span
                        className={`mt-0.5 shrink-0 ${CHECK[c.result].className}`}
                        title={CHECK[c.result].label}
                      >
                        {CHECK[c.result].icon}
                      </span>
                      <span>
                        <span className="text-text">{c.what}</span>
                        <span className="text-text-3"> · {CHECK[c.result].label}</span>
                        {c.note && <span className="block text-xs text-text-2">{c.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-3">Нет данных</p>
              )}
            </Card>
            <Card title="Проблемы">
              {report.problems.length ? (
                <ul className="flex flex-col gap-2">
                  {report.problems.map((p) => (
                    <li key={p.text} className="flex items-start gap-2 text-sm">
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${SEVERITY[p.severity].className}`}
                      >
                        {SEVERITY[p.severity].icon}
                        {SEVERITY[p.severity].label}
                      </span>
                      <span className="text-text">
                        {p.text}
                        {p.where && <span className="block text-xs text-text-3">{p.where}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-3">Проблем не найдено</p>
              )}
            </Card>
            <Card title="Решения">
              <List items={report.decisions} empty="Решений не принималось" />
            </Card>
          </div>
          <Card title="Что дальше" className="mb-4">
            <List items={report.next} empty="Ничего не осталось" />
          </Card>
        </>
      ) : (
        <Card title="Сводка" className="mb-4">
          <p className="text-sm text-text-2">
            Сводка ещё не собрана. Нажмите «Собрать отчёт»: модель прочитает отчёты этапов и коротко
            распишет, что сделано и проверено, какие проблемы и блокеры.
          </p>
        </Card>
      )}

      <Card title="Этапы" hint={`${chatCount} сообщений в чате конвейера`} className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs text-text-3">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Этап</th>
                <th className="py-1.5 pr-3 font-medium">Кто</th>
                <th className="py-1.5 pr-3 font-medium">Статус</th>
                <th className="py-1.5 font-medium">Доработок</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.id} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 text-text">{f.label}</td>
                  <td className="py-1.5 pr-3 text-text-2">
                    {f.role ?? (f.kind === 'gate' ? 'Вы' : '—')}
                  </td>
                  <td className="py-1.5 pr-3 text-text-2">
                    {STAGE_LABEL[f.status as keyof typeof STAGE_LABEL] ?? f.status}
                    {f.verdict === 'rework'
                      ? ' · на доработку'
                      : f.verdict === 'approved'
                        ? ' · одобрено'
                        : ''}
                  </td>
                  <td className="py-1.5 tabular text-text-2">{f.attempts || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Подробно: отчёты этапов" hint="Полный текст каждого этапа, открывается по клику">
        <Collapsible maxHeight={2000}>
          <div className="flex flex-col">
            {facts.map((f) => (
              <div key={f.id} className="border-t border-border py-2 first:border-t-0">
                <div className="text-sm font-medium text-text">{f.label}</div>
                <StageResult stageId={f.id} gate={f.kind === 'gate'} />
              </div>
            ))}
          </div>
        </Collapsible>
      </Card>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-text-2">Расходы</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Стоимость" value={formatUsd(costUsd)} />
        <Tile label="Токенов" value={formatTokens(tokens).replace(' токенов', '')} />
        <Tile
          label="Время агентов"
          value={duration(workMs)}
          hint={`с ${formatDateTime(pipeline.createdAt)}`}
        />
        <Tile
          label="Дороже всего"
          value={priciest ? formatUsd(priciest.costUsd) : '—'}
          hint={priciest?.label}
        />
      </div>
      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Card title="Стоимость по этапам" hint="Все запуски этапа, включая доработки">
          <Bars
            rows={agents.map((f) => ({
              label: f.label,
              value: f.costUsd,
              text: formatUsd(f.costUsd),
            }))}
          />
        </Card>
        <Card title="Время по этапам" hint="Сколько агенты работали на этапе">
          <Bars rows={agents.map((f) => ({ label: f.label, value: f.ms, text: duration(f.ms) }))} />
        </Card>
      </div>
    </>
  )
}

export default ReportPage
