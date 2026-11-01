// USD per 1M tokens, Anthropic first-party API rates (cached 2026-10-06).
// Cache writes: 1.25x input for the 5-minute TTL, 2x for 1-hour. Cache reads differ per model.
type Price = { input: number; output: number; cacheRead: number }

const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08 },
}

// Longest key first so 'claude-opus-5-5' wins over 'claude-opus-5'
const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length)

export const priceFor = (model: string): Price | undefined => {
  const key = KEYS.find((k) => model.startsWith(k))
  return key ? PRICES[key] : undefined
}

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
  fast: boolean
}

export const costUsd = (model: string, usage: Usage) => {
  const price = priceFor(model)
  if (!price) return 0
  const base =
    usage.input * price.input +
    usage.output * price.output +
    usage.cacheRead * price.cacheRead +
    usage.cacheWrite5m * price.input * 1.25 +
    usage.cacheWrite1h * price.input * 2
  return (base * (usage.fast ? 2 : 1)) / 1_000_000
}
