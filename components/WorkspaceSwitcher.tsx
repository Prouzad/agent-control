'use client'

import { Layers } from 'lucide-react'
import { useTransition } from 'react'

import { setWorkspaceAction } from '@/app/actions'

import { Select } from './Select'

type Props = {
  current: string | null
  projects: { id: string; label: string }[]
}

// Narrows the whole dashboard to one project and its sub-projects
export const WorkspaceSwitcher = (props: Props) => {
  const [pending, startTransition] = useTransition()
  return (
    <label className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-2.5 py-1.5 text-sm">
      <Layers size={15} className="shrink-0 text-accent" aria-hidden />
      <span className="sr-only">Рабочая область</span>
      <Select
        ariaLabel="Рабочая область"
        value={props.current ?? ''}
        disabled={pending}
        onChange={(value) => startTransition(() => setWorkspaceAction(value))}
        variant="bare"
        options={[
          { value: '', label: 'Все проекты' },
          ...props.projects.map((p) => ({ value: p.id, label: p.label })),
        ]}
      />
    </label>
  )
}
