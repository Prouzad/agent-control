// Narrowing helpers for untyped JSON (transcripts) without type assertions
export type Json = Record<string, unknown>

export const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const obj = (v: unknown): Json | undefined => (isObj(v) ? v : undefined)

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export const parseJson = (line: string): Json | undefined => {
  try {
    return obj(JSON.parse(line))
  } catch {
    return undefined
  }
}
