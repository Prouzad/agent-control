'use client'

import { Loader2, RefreshCw } from 'lucide-react'
import { useActionState } from 'react'

import { generateReportAction, setReportAutoAction } from '../../actions'

// Rebuilding takes a model call (10–30 s), so the button says what is happening
export const RefreshReport = (props: { pipelineId: string; hasReport: boolean }) => {
  const [state, action, pending] = useActionState(() => generateReportAction(props.pipelineId), {
    error: null,
  })
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="btn-primary inline-flex items-center gap-1.5"
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <RefreshCw size={14} aria-hidden />
        )}
        {pending ? 'Собираю отчёт…' : props.hasReport ? 'Обновить отчёт' : 'Собрать отчёт'}
      </button>
      {state.error && <p className="text-xs text-critical">{state.error}</p>}
    </form>
  )
}

// Rebuilds the summary after every stage (one short model call each); the figures are always live
export const ReportAutoSwitch = (props: { pipelineId: string; on: boolean }) => (
  <form action={setReportAutoAction.bind(null, props.pipelineId, !props.on)}>
    <button
      type="submit"
      role="switch"
      aria-checked={props.on}
      className="inline-flex items-center gap-2 text-xs text-text-2 hover:text-text"
      title="Сводка пересобирается после каждого этапа: один короткий вызов модели, ~$0.1–0.2"
    >
      <span
        className={`relative inline-block h-4 w-7 rounded-full transition-colors ${props.on ? 'bg-accent' : 'bg-surface-2'}`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${props.on ? 'left-3.5' : 'left-0.5'}`}
        />
      </span>
      Автообновление сводки после каждого этапа
    </button>
  </form>
)
