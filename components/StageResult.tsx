'use client'

import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { obj, str } from '@/lib/json'

import { Collapsible } from './Collapsible'
import { Markdown, Report } from './Markdown'

type Props = {
  stageId: string
  gate: boolean
  // A result the person must act on comes with the page and starts open
  initial?: string
}

// A stage's result loads when opened, so the page does not carry every report on each refresh
export const StageResult = (props: Props) => {
  const [output, setOutput] = useState<string | null>(props.initial ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (output !== null || loading) return
    setLoading(true)
    try {
      const response = await fetch(`/api/stage?id=${props.stageId}`)
      const body = obj(await response.json())
      if (!response.ok) throw new Error(str(body?.['error']) ?? 'Не удалось загрузить результат')
      setOutput(str(body?.['output']) ?? '')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  return (
    <details
      className="mt-2"
      open={props.initial !== undefined}
      onToggle={(event) => event.currentTarget.open && void load()}
    >
      <summary className="cursor-pointer text-sm text-accent">
        {props.gate ? 'Решение гейта' : 'Результат этапа'}
      </summary>
      <div className="mt-2 max-h-[70vh] overflow-auto rounded-md bg-surface-2 p-3">
        {loading && (
          <p className="inline-flex items-center gap-1.5 text-sm text-text-3">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Загружаю…
          </p>
        )}
        {error && <p className="text-sm text-critical">{error}</p>}
        {output !== null &&
          (props.gate ? (
            <Collapsible maxHeight={320}>
              <Markdown>{output}</Markdown>
            </Collapsible>
          ) : (
            <Report text={output} />
          ))}
      </div>
    </details>
  )
}
