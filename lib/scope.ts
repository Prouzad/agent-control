import { projectWithDescendants } from '@/server/projects'
import { readView } from '@/server/visibility'
import type { Scope } from '@/server/queries'

export const PERIODS = [
  { key: '7', label: '7 дней', days: 7 },
  { key: '30', label: '30 дней', days: 30 },
  { key: '90', label: '90 дней', days: 90 },
  { key: 'all', label: 'Всё время', days: null },
] as const

export type SearchParams = Promise<Record<string, string | string[] | undefined>>

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export const readScope = async (searchParams: SearchParams) => {
  const params = await searchParams
  const period = PERIODS.find((p) => p.key === first(params['period'])) ?? PERIODS[1]
  const project = first(params['project']) ?? null
  const since = period.days
    ? new Date(Date.now() - period.days * 24 * 60 * 60 * 1000).toISOString()
    : null
  const view = await readView()
  // A hidden project or one outside the workspace cannot be picked as a filter
  const picked = project && view.allowsProject(project) ? project : null
  const projectIds = picked
    ? projectWithDescendants(picked)
    : view.allowed
      ? [...view.allowed]
      : null
  const scope: Scope = { since, projectIds, excludeIds: [...view.hidden] }
  return { scope, period: period.key, project: picked, view }
}
