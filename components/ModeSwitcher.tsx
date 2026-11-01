'use client'

import { ShieldCheck } from 'lucide-react'
import { useTransition } from 'react'

import { PERMISSION_MODE_LABEL } from '@/lib/taskStatus'

import { Select } from './Select'

type Props = {
  value: string
  // A server action bound to the task or pipeline
  action: (mode: string) => Promise<void>
}

// Permission mode of a running task or pipeline, switchable on the fly
export const ModeSwitcher = (props: Props) => {
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex w-72 max-w-full items-center gap-1.5">
      <ShieldCheck size={15} className="shrink-0 text-text-3" aria-hidden />
      <Select
        ariaLabel="Режим разрешений"
        size="sm"
        value={props.value}
        disabled={pending}
        onChange={(mode) => startTransition(() => props.action(mode))}
        options={Object.entries(PERMISSION_MODE_LABEL).map(([value, label]) => ({ value, label }))}
      />
    </div>
  )
}
