'use client'

import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { obj, str } from '@/lib/json'

const lineClass = (line: string) =>
  line.startsWith('+') && !line.startsWith('+++')
    ? 'text-good'
    : line.startsWith('-') && !line.startsWith('---')
      ? 'text-critical'
      : line.startsWith('@@')
        ? 'text-accent'
        : 'text-text-2'

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; patch: string; truncated: boolean }
  | { kind: 'error'; message: string }

// The patch loads only when opened: a large branch would otherwise ship megabytes of diff with
// every live refresh of the page
export const DiffPatch = (props: { source: { task: string } | { pipeline: string } }) => {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const query =
    'task' in props.source ? `task=${props.source.task}` : `pipeline=${props.source.pipeline}`

  const load = async () => {
    if (state.kind !== 'idle') return
    setState({ kind: 'loading' })
    try {
      const response = await fetch(`/api/diff?${query}`)
      const body = obj(await response.json())
      if (!response.ok) throw new Error(str(body?.['error']) ?? 'Не удалось загрузить diff')
      setState({
        kind: 'ready',
        patch: str(body?.['patch']) ?? '',
        truncated: body?.['truncated'] === true,
      })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <details onToggle={(event) => event.currentTarget.open && void load()}>
      <summary className="cursor-pointer text-sm text-accent">Показать diff</summary>
      {state.kind === 'loading' && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-text-3">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Загружаю…
        </p>
      )}
      {state.kind === 'error' && <p className="mt-2 text-sm text-critical">{state.message}</p>}
      {state.kind === 'ready' && (
        <>
          {state.truncated && (
            <p className="mt-2 text-xs text-text-3">Показано начало: diff слишком большой</p>
          )}
          <pre className="mt-2 max-h-[70vh] overflow-auto rounded-md bg-surface-2 p-3 font-mono text-xs">
            {state.patch.split('\n').map((line, index) => (
              <div key={index} className={lineClass(line)}>
                {line || ' '}
              </div>
            ))}
          </pre>
        </>
      )}
    </details>
  )
}
