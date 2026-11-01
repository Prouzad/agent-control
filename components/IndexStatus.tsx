import { RefreshCw } from 'lucide-react'

import { reindex } from '@/app/actions'
import { formatTime } from '@/lib/format'
import { isIndexing, lastIndex } from '@/server/indexer'

export const IndexStatus = () => {
  const last = lastIndex()
  const running = isIndexing()
  return (
    <form action={reindex} className="flex items-center gap-2 text-xs text-text-3">
      <span className="min-w-0 flex-1 truncate" aria-live="polite">
        {running
          ? 'Индексация…'
          : last
            ? `Индекс: ${formatTime(last.at)} · ${last.files} файлов`
            : 'Индекс ещё не собран'}
      </span>
      <button
        type="submit"
        className="rounded p-1 hover:bg-surface-2 hover:text-text"
        aria-label="Обновить индекс"
        title="Обновить индекс"
      >
        <RefreshCw size={14} aria-hidden />
      </button>
    </form>
  )
}
