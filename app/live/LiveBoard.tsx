'use client'

import {
  AlertTriangle,
  CircleDot,
  Clock,
  Hand,
  ListTodo,
  Loader2,
  MoonStar,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Robot, type RobotState } from '@/components/Robot'
import { formatInt, formatTime, formatUsd, shortPath } from '@/lib/format'
import type { LiveSession, LiveSnapshot, LiveStatus } from '@/server/live'

const ROBOT_STATE: Record<LiveStatus, RobotState> = {
  waiting: 'waiting',
  working: 'working',
  stale: 'offline',
  idle: 'idle',
  ended: 'offline',
}

const STATUS: Record<LiveStatus, { label: string; icon: LucideIcon; className: string }> = {
  waiting: { label: 'Ждёт вас', icon: Hand, className: 'bg-warning/15 text-warning' },
  working: { label: 'Работает', icon: Loader2, className: 'bg-good/15 text-good' },
  stale: { label: 'Нет сигналов', icon: Clock, className: 'bg-surface-2 text-text-2' },
  idle: { label: 'Ждёт промпта', icon: MoonStar, className: 'bg-surface-2 text-text-2' },
  ended: { label: 'Завершена', icon: CircleDot, className: 'bg-surface-2 text-text-3' },
}

const EVENT_LABELS: Record<string, string> = {
  SessionStart: 'сессия начата',
  SessionEnd: 'сессия завершена',
  UserPromptSubmit: 'промпт',
  PreToolUse: 'инструмент',
  PostToolUseFailure: 'ошибка инструмента',
  PermissionRequest: 'нужно разрешение',
  Notification: 'уведомление',
  SubagentStart: 'субагент запущен',
  SubagentStop: 'субагент завершён',
  Stop: 'ход завершён',
  StopFailure: 'ход упал',
  TaskCreated: 'задача создана',
  TaskCompleted: 'задача закрыта',
  TeammateIdle: 'тиммейт свободен',
}

const ago = (iso: string, now: number) => {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

const StatusBadge = (props: { status: LiveStatus }) => {
  const status = STATUS[props.status]
  const Icon = status.icon
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
    >
      <Icon
        size={12}
        className={props.status === 'working' ? 'animate-spin [animation-duration:2.5s]' : ''}
        aria-hidden
      />
      {status.label}
    </span>
  )
}

const SessionCard = (props: { session: LiveSession; now: number }) => {
  const s = props.session
  return (
    <article className="group glass flex flex-col gap-3 rounded-2xl p-4">
      <header className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Robot
            seed={s.roleId ?? s.sessionId}
            team={s.teamId}
            state={ROBOT_STATE[s.status]}
            size={52}
            label={s.title ?? 'Агент'}
          />
          {s.tool && s.status === 'working' && (
            <span className="absolute -top-2 left-1/2 max-w-24 -translate-x-1/2 truncate rounded-full border border-accent/40 bg-surface-solid px-1.5 font-mono text-[10px] text-accent shadow-[0_0_10px_var(--glow)]">
              {s.tool.name}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/sessions/${s.sessionId}`}
            className="block truncate font-medium hover:text-accent"
          >
            {s.title ?? s.sessionId.slice(0, 8)}
          </Link>
          <div className="truncate text-xs text-text-3">
            {s.stageLabel ? `Этап «${s.stageLabel}» · ` : ''}
            {s.projectName ? `${s.projectName} · ` : ''}
            {shortPath(s.cwd)}
          </div>
        </div>
        <StatusBadge status={s.status} />
      </header>

      {(s.pipelineId || s.taskId) && (
        <Link
          href={
            s.pipelineId
              ? `/pipelines/${s.pipelineId}${s.stageId ? `#stage-${s.stageId}` : ''}`
              : `/tasks/${s.taskId}`
          }
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-text-2 hover:border-accent hover:text-text"
        >
          {s.pipelineId ? (
            <Workflow size={13} className="text-accent" aria-hidden />
          ) : (
            <ListTodo size={13} className="text-accent" aria-hidden />
          )}
          {s.pipelineId ? 'Открыть конвейер' : 'Открыть задачу'}
          {s.status === 'waiting' && <span className="text-warning">· ждёт решения</span>}
        </Link>
      )}

      {s.note && (
        <p className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-sm">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          {s.note}
        </p>
      )}

      {s.tool ? (
        <div className="rounded-md bg-surface-2 px-2.5 py-2 text-sm">
          <div className="flex items-center justify-between gap-2 text-xs text-text-3">
            <span className="font-mono text-text">{s.tool.name}</span>
            <span className="tabular">{ago(s.tool.since, props.now)}</span>
          </div>
          {s.tool.summary && <div className="mt-0.5 truncate text-text-2">{s.tool.summary}</div>}
        </div>
      ) : (
        s.lastPrompt && (
          <p className="line-clamp-2 text-sm text-text-2">
            <span className="text-text-3">Промпт: </span>
            {s.lastPrompt}
          </p>
        )
      )}

      {s.agents.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm" aria-label="Работающие субагенты">
          {s.agents.map((agent) => (
            <li key={agent.agentId} className="flex items-center gap-2">
              <Robot
                seed={agent.agentType ?? agent.agentId}
                state={agent.tool ? 'working' : 'idle'}
                size={20}
              />
              <span className="shrink-0 text-text-2">{agent.agentType ?? 'субагент'}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-3">
                {agent.tool ? `${agent.tool.name} · ${agent.tool.summary ?? ''}` : 'думает…'}
              </span>
              <span className="tabular shrink-0 text-xs text-text-3">
                {ago(agent.since, props.now)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto flex items-center gap-3 border-t border-border pt-2 text-xs text-text-3">
        <span>Активность {ago(s.lastEventAt, props.now)} назад</span>
        <span className="ml-auto tabular">{formatInt(s.toolCalls)} инстр.</span>
        <span className="tabular">{formatUsd(s.costUsd)}</span>
        {s.source === 'transcript' && <span title="Без хуков: по записи транскрипта">~</span>}
      </footer>
    </article>
  )
}

const REFRESH_THROTTLE_MS = 500
const PERIODIC_REFRESH_MS = 30_000

export const LiveBoard = (props: { initial: LiveSnapshot }) => {
  const [snapshot, setSnapshot] = useState(props.initial)
  const [connected, setConnected] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Coalesce bursts of events into one snapshot fetch
  const refresh = useCallback(() => {
    if (pending.current) return
    pending.current = setTimeout(async () => {
      pending.current = null
      try {
        const response = await fetch('/api/live', { cache: 'no-store' })
        if (response.ok) setSnapshot(await response.json())
      } catch {
        // Next event or the periodic refresh retries
      }
    }, REFRESH_THROTTLE_MS)
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/live/stream')
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.addEventListener('hook', refresh)
    source.addEventListener('index', refresh)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const periodic = setInterval(refresh, PERIODIC_REFRESH_MS)
    return () => {
      source.close()
      clearInterval(tick)
      clearInterval(periodic)
    }
  }, [refresh])

  const active = snapshot.sessions

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-text-2">
        <span className="inline-flex items-center gap-1.5" aria-live="polite">
          <span
            className={`size-2 rounded-full ${connected ? 'bg-good' : 'bg-text-3'}`}
            aria-hidden
          />
          {connected ? 'Поток подключён' : 'Переподключение…'}
        </span>
        <span>
          {active.length} {active.length === 1 ? 'активная сессия' : 'активных сессий'}
        </span>
      </div>

      {!snapshot.hooksSeen && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Хуки ещё не присылали событий. Пока сессии видны по записи транскриптов, с задержкой до 15
          с.{' '}
          <Link href="/settings" className="font-medium text-accent hover:underline">
            Установить хуки →
          </Link>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="xl:col-span-2" aria-label="Активные сессии">
          {active.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {active.map((session) => (
                <SessionCard key={session.sessionId} session={session} now={now} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong px-4 py-12 text-center text-sm text-text-2">
              <div className="flex items-end gap-2">
                <Robot seed="idle-1" state="offline" size={36} />
                <Robot seed="idle-2" state="idle" size={44} />
                <Robot seed="idle-3" state="offline" size={36} />
              </div>
              Зал пуст — ни одна сессия сейчас не работает
            </div>
          )}
        </section>

        <section className="glass rounded-2xl p-4" aria-label="Лента событий">
          <h2 className="mb-3 text-sm font-medium">Лента событий</h2>
          {snapshot.feed.length ? (
            <ol className="flex flex-col">
              {snapshot.feed.map((e) => (
                <li key={e.id} className="border-b border-border py-1.5 text-sm last:border-0">
                  <div className="flex items-center gap-2 text-xs text-text-3">
                    <span className="tabular">{formatTime(e.ts)}</span>
                    <span
                      className={
                        e.event === 'PostToolUseFailure' || e.event === 'StopFailure'
                          ? 'text-critical'
                          : e.event === 'PermissionRequest' || e.event === 'Notification'
                            ? 'text-warning'
                            : ''
                      }
                    >
                      {EVENT_LABELS[e.event] ?? e.event}
                    </span>
                    {e.agentType && <span>· {e.agentType}</span>}
                    <Link
                      href={`/sessions/${e.sessionId}`}
                      className="ml-auto min-w-0 truncate hover:text-accent"
                    >
                      {snapshot.titles[e.sessionId] ?? e.sessionId.slice(0, 8)}
                    </Link>
                  </div>
                  {(e.toolName || e.summary) && (
                    <div className="truncate text-text-2">
                      {e.toolName && (
                        <span className="font-mono text-xs text-text">{e.toolName} </span>
                      )}
                      {e.summary}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-center text-sm text-text-3">Событий пока нет</p>
          )}
        </section>
      </div>
    </div>
  )
}
