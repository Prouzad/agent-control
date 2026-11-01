// Chart series are model families: a fixed family → color mapping keeps colors stable across filters
export const FAMILIES = [
  { key: 'opus', label: 'Opus', color: 'var(--series-1)' },
  { key: 'sonnet', label: 'Sonnet', color: 'var(--series-2)' },
  { key: 'haiku', label: 'Haiku', color: 'var(--series-3)' },
  { key: 'fable', label: 'Fable', color: 'var(--series-4)' },
  { key: 'other', label: 'Другие', color: 'var(--series-other)' },
] as const

export type FamilyKey = (typeof FAMILIES)[number]['key']

export const familyOf = (model: string): FamilyKey => {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  if (model.includes('fable') || model.includes('mythos')) return 'fable'
  return 'other'
}
