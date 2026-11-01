import type { ReactNode } from 'react'

import { CountUp } from './CountUp'

export const PageHeader = (props: {
  title: string
  description?: string
  actions?: ReactNode
  // A robot or icon shown left of the title
  icon?: ReactNode
}) => (
  <header className="group mb-6 flex flex-wrap items-end justify-between gap-3">
    {/* On phones the icon sits above the title so a long title keeps the full width */}
    <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
      {props.icon && <div className="shrink-0">{props.icon}</div>}
      <div className="min-w-0">
        <h1 className="font-display text-gradient text-xl font-semibold sm:text-2xl">
          {props.title}
        </h1>
        {props.description && (
          <p className="mt-1.5 max-w-3xl text-sm text-text-2">{props.description}</p>
        )}
      </div>
    </div>
    {props.actions}
  </header>
)

export const Card = (props: {
  title?: string
  hint?: string
  children: ReactNode
  className?: string
  // An opaque card without the blur: a WebGL canvas under backdrop-filter flickers in Chrome
  // while the page scrolls
  solid?: boolean
}) => (
  <section
    className={`${props.solid ? 'glass glass--solid' : 'glass'} rounded-2xl p-4 ${props.className ?? ''}`}
  >
    {props.title && (
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-wide">{props.title}</h2>
        {props.hint && <p className="mt-0.5 text-xs text-text-3">{props.hint}</p>}
      </div>
    )}
    {props.children}
  </section>
)

type StatProps = {
  label: string
  sub?: string
  icon?: ReactNode
} & ({ value: string } | { count: number; format: 'usd' | 'compact' | 'int' | 'percent' })

export const StatTile = (props: StatProps) => (
  <div className="glass glass-hover relative flex min-h-28 flex-col justify-between overflow-hidden rounded-2xl p-4">
    <div className="flex items-center justify-between gap-2 text-xs text-text-2">
      {props.label}
      {props.icon && <span className="text-accent">{props.icon}</span>}
    </div>
    <div>
      <div className="font-display text-2xl font-semibold">
        {'count' in props ? <CountUp value={props.count} format={props.format} /> : props.value}
      </div>
      {props.sub && <div className="mt-0.5 text-xs text-text-3">{props.sub}</div>}
    </div>
    <span
      className="pointer-events-none absolute -right-6 -bottom-8 size-24 rounded-full bg-accent opacity-10 blur-2xl"
      aria-hidden
    />
  </div>
)

export type BarListItem = {
  key: string
  label: ReactNode
  value: number
  display: string
  sub?: string
}

// Ranked horizontal bars, every bar direct-labeled with its value
export const BarList = (props: { items: BarListItem[]; empty?: string }) => {
  const max = Math.max(...props.items.map((i) => i.value), 0)
  if (!props.items.length || max === 0) {
    return <p className="py-6 text-center text-sm text-text-3">{props.empty ?? 'Нет данных'}</p>
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {props.items.map((item) => (
        <li key={item.key} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="tabular shrink-0 text-text-2">
              {item.display}
              {item.sub && <span className="ml-1.5 text-xs text-text-3">{item.sub}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 shadow-[0_0_8px_var(--glow)]"
              style={{ width: `${Math.max(1, (item.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export const Empty = (props: { children: ReactNode }) => (
  <div className="rounded-2xl border border-dashed border-border-strong px-4 py-10 text-center text-sm text-text-2">
    {props.children}
  </div>
)
