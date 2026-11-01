const usd = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })

const integer = new Intl.NumberFormat('ru-RU')

export const formatUsd = (value: number) => usd.format(value)

export const formatCompact = (value: number) => compact.format(value)

export const formatTokens = (value: number) => `${compact.format(value)} токенов`

export const formatInt = (value: number) => integer.format(value)

export const formatPercent = (value: number) =>
  `${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const time = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

export const formatDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—')

export const formatTime = (iso: string) => time.format(new Date(iso))

// 'YYYY-MM-DD' local day key → '27 окт.'
export const formatDay = (key: string) => day.format(new Date(`${key}T12:00:00`))

export const formatDuration = (from: string | null, to: string | null) => {
  if (!from || !to) return '—'
  const minutes = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000)
  if (minutes < 1) return '< 1 мин'
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ч ${minutes % 60} мин`
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`
}

// 'claude-opus-5-5' → 'Opus 5.5'; unknown ids pass through
export const modelLabel = (model: string) => {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model)
  if (!match?.[1] || !match[2]) return model
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1)
  const minor = match[3] && match[3].length <= 2 ? `.${match[3]}` : ''
  return `${family} ${match[2]}${minor}`
}

export const shortPath = (value: string | null) =>
  value ? value.replace(/^\/Users\/[^/]+/, '~') : '—'
