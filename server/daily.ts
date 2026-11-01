import type { DailyPoint } from '@/components/DailyCostChart'
import { familyOf } from '@/lib/series'

import { dailyByModel, type Scope } from './queries'

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// Daily cost per model family, with empty days filled so gaps read as zero
export const dailyCost = (scope: Scope): DailyPoint[] => {
  const rows = dailyByModel(scope)
  const byDay = new Map<string, DailyPoint>()
  for (const row of rows) {
    const point = byDay.get(row.day) ?? { day: row.day, values: {} }
    const family = familyOf(row.model)
    point.values[family] = (point.values[family] ?? 0) + row.costUsd
    byDay.set(row.day, point)
  }
  const firstDay = scope.since ? dayKey(new Date(scope.since)) : rows[0]?.day
  if (!firstDay) return []
  const points: DailyPoint[] = []
  const cursor = new Date(`${firstDay}T12:00:00`)
  const today = dayKey(new Date())
  while (dayKey(cursor) <= today) {
    const key = dayKey(cursor)
    points.push(byDay.get(key) ?? { day: key, values: {} })
    cursor.setDate(cursor.getDate() + 1)
  }
  return points
}
