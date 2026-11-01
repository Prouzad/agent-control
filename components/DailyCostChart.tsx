'use client'

import { useState } from 'react'

import { formatDay, formatUsd } from '@/lib/format'
import { FAMILIES, type FamilyKey } from '@/lib/series'

export type DailyPoint = { day: string; values: Partial<Record<FamilyKey, number>> }

type Props = { data: DailyPoint[]; height?: number }

const total = (point: DailyPoint) =>
  Object.values(point.values).reduce((sum, v) => sum + (v ?? 0), 0)

// Stacked daily cost by model family; hover shows the day's breakdown
export const DailyCostChart = (props: Props) => {
  const height = props.height ?? 220
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...props.data.map(total), 0)
  const present = FAMILIES.filter((f) => props.data.some((p) => (p.values[f.key] ?? 0) > 0))
  const active = hovered === null ? undefined : props.data[hovered]
  // Label roughly six evenly spaced days so the axis never crowds
  const labelEvery = Math.max(1, Math.ceil(props.data.length / 6))

  if (max === 0) {
    return <p className="py-10 text-center text-sm text-text-3">Нет данных за период</p>
  }

  return (
    <div>
      {present.length > 1 && (
        <ul
          className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2"
          aria-label="Легенда"
        >
          {present.map((f) => (
            <li key={f.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: f.color }} aria-hidden />
              {f.label}
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <div
          className="flex items-end gap-[2px] border-b border-border"
          style={{ height }}
          onMouseLeave={() => setHovered(null)}
          role="img"
          aria-label={`Стоимость по дням, максимум ${formatUsd(max)} в день`}
        >
          {props.data.map((point, index) => (
            <div
              key={point.day}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              onMouseEnter={() => setHovered(index)}
            >
              <div
                className={`flex flex-col-reverse gap-[2px] ${hovered !== null && hovered !== index ? 'opacity-50' : ''}`}
              >
                {present.map((f, i) => {
                  const value = point.values[f.key] ?? 0
                  if (value <= 0) return null
                  const isTop = present
                    .slice(i + 1)
                    .every((next) => (point.values[next.key] ?? 0) <= 0)
                  return (
                    <div
                      key={f.key}
                      className={isTop ? 'rounded-t' : ''}
                      style={{
                        background: f.color,
                        height: Math.max(1, (value / max) * (height - 4)),
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {active && hovered !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-40 glass rounded-lg px-3 py-2 text-xs"
            style={{
              left: `${((hovered + 0.5) / props.data.length) * 100}%`,
              transform: hovered > props.data.length / 2 ? 'translateX(-105%)' : 'translateX(5%)',
            }}
          >
            <div className="mb-1 font-medium">{formatDay(active.day)}</div>
            {present.map((f) => (
              <div key={f.key} className="flex items-center gap-2 text-text-2">
                <span className="size-2 rounded-sm" style={{ background: f.color }} aria-hidden />
                <span className="flex-1">{f.label}</span>
                <span className="tabular text-text">{formatUsd(active.values[f.key] ?? 0)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
              <span>Итого</span>
              <span className="tabular">{formatUsd(total(active))}</span>
            </div>
          </div>
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-text-3" aria-hidden>
        {props.data.map((point, index) => {
          if (index % labelEvery !== 0) return null
          const position = (index + 0.5) / props.data.length
          // Edge labels anchor inward so they never overflow the card
          const shift = position < 0.08 ? '0' : position > 0.92 ? '-100%' : '-50%'
          return (
            <span
              key={point.day}
              className="absolute whitespace-nowrap"
              style={{
                left: `${position * 100}%`,
                transform: `translateX(${shift})`,
              }}
            >
              {formatDay(point.day)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
