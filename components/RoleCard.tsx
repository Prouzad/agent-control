import { Crown } from 'lucide-react'
import Link from 'next/link'

import { modelChoiceLabel } from '@/lib/roles'
import type { Role } from '@/server/org'

import { Robot, type RobotState } from './Robot'

export const RoleCard = (props: { role: Role; teamName?: string; state?: RobotState }) => {
  const role = props.role
  const canEdit = role.tools.some((t) => t === 'Edit' || t === 'Write')
  return (
    <Link href={`/agents/${role.id}`} className="group glass flex gap-3 rounded-2xl p-4">
      <div className="shrink-0 pt-1">
        <Robot seed={role.id} team={role.teamId} state={props.state ?? 'idle'} size={52} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-semibold">
              {role.isLead && (
                <Crown size={14} className="shrink-0 text-warning" aria-label="Лид команды" />
              )}
              <span className="truncate">{role.title}</span>
            </div>
            <div className="font-mono text-[11px] text-text-3">{role.id}</div>
          </div>
          <span className="shrink-0 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-2">
            {modelChoiceLabel(role.model)}
          </span>
        </div>
        <p className="line-clamp-2 text-sm text-text-2">{role.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs text-text-3">
          {props.teamName && <span>{props.teamName} ·</span>}
          <span className={canEdit ? 'text-accent' : ''}>
            {canEdit ? 'меняет код' : 'только читает'}
          </span>
          {role.skills.length > 0 && <span>· {role.skills.map((s) => `/${s}`).join(' ')}</span>}
        </div>
      </div>
    </Link>
  )
}
