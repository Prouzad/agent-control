'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Select } from './Select'

type Props = {
  periods: { key: string; label: string }[]
  period: string
  projects: { id: string; label: string }[]
  project: string | null
}

// Period and project filters live in the URL, so every view is linkable
export const FilterBar = (props: Props) => {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const hrefWith = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    const query = params.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex rounded-lg border border-border bg-surface-2 p-0.5"
        role="group"
        aria-label="Период"
      >
        {props.periods.map((p) => (
          <Link
            key={p.key}
            href={hrefWith('period', p.key)}
            aria-current={p.key === props.period ? 'true' : undefined}
            className={`rounded px-2.5 py-1 text-xs ${p.key === props.period ? 'bg-accent-soft font-medium text-accent' : 'text-text-2 hover:text-text'}`}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <div className="w-48">
        <Select
          ariaLabel="Проект"
          size="sm"
          value={props.project ?? ''}
          onChange={(value) => router.push(hrefWith('project', value || null))}
          options={[
            { value: '', label: 'Все проекты' },
            ...props.projects.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
      </div>
    </div>
  )
}
