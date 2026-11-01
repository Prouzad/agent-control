import Link from 'next/link'

import { taskRobotState } from '@/lib/taskStatus'
import { runnerStatus } from '@/server/runner'
import { pendingPermissions } from '@/server/tasks'
import { readView, visibleTasks, visibleTeams } from '@/server/visibility'

import { Robot } from './Robot'

const ACTIVE = ['running', 'waiting', 'todo']

// The crew strip: agents at work right now, or the team leads standing by
export const Crew = async () => {
  const status = await runnerStatus()
  const waiting = new Set(pendingPermissions().map((p) => p.taskId))
  const view = await readView()
  const teams = visibleTeams(view)
  const roles = new Map(teams.flatMap((t) => t.roles).map((r) => [r.id, r]))
  const active = visibleTasks(view).filter((t) => ACTIVE.includes(t.status))
  const leads = teams.flatMap((team) => team.roles.filter((r) => r.isLead))

  return (
    <section className="glass mb-4 overflow-hidden rounded-2xl p-4" aria-label="Экипаж">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-wide">
            {active.length ? 'Экипаж в работе' : 'Экипаж ждёт задач'}
          </h2>
          <p className="text-xs text-text-3">
            {status.running} из {status.maxParallel} слотов · свободно памяти{' '}
            {status.freeMemoryPercent}%
          </p>
        </div>
        <Link href={active.length ? '/tasks' : '/pipelines#new-pipeline'} className="btn-primary">
          {active.length ? 'Открыть задачи' : 'Запустить конвейер'}
        </Link>
      </div>
      <ul className="flex flex-wrap items-end justify-around gap-x-3 gap-y-4">
        {active.length
          ? active.map((task) => {
              const role = task.roleId ? roles.get(task.roleId) : undefined
              return (
                <li key={task.id} className="group shrink-0">
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex w-24 flex-col items-center gap-1 text-center"
                  >
                    <Robot
                      seed={task.roleId ?? task.id}
                      team={role?.teamId}
                      state={taskRobotState(task.status, waiting.has(task.id))}
                      size={56}
                      label={role?.title ?? 'Агент'}
                    />
                    <span className="line-clamp-2 text-[11px] text-text-2">{task.title}</span>
                  </Link>
                </li>
              )
            })
          : leads.map((lead) => (
              <li key={lead.id} className="group shrink-0">
                <Link
                  href={`/agents/${lead.id}`}
                  className="flex w-20 flex-col items-center gap-1 text-center"
                >
                  <Robot
                    seed={lead.id}
                    team={lead.teamId}
                    state="idle"
                    size={48}
                    label={lead.title}
                  />
                  <span className="line-clamp-2 text-[11px] text-text-3">{lead.title}</span>
                </Link>
              </li>
            ))}
      </ul>
    </section>
  )
}
