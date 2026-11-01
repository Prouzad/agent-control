'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { obj, str } from '@/lib/json'

const THROTTLE_MS = 700

type Props = {
  // Only events of this task
  taskId?: string
  // Only events of this pipeline or of its tasks
  pipelineId?: string
  taskIds?: string[]
}

// Re-renders the server page when a matching task event arrives over SSE. A hidden tab does not
// refresh; it catches up once when it is shown again
export const LiveRefresh = (props: Props) => {
  const router = useRouter()
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const missed = useRef(false)
  const taskIds = props.taskIds?.join(',') ?? ''

  useEffect(() => {
    const ids = new Set(taskIds ? taskIds.split(',') : [])
    const filtered = Boolean(props.taskId || props.pipelineId)
    const matches = (raw: string) => {
      if (!filtered) return true
      try {
        const data = obj(JSON.parse(raw))
        const taskId = str(data?.['taskId'])
        const pipelineId = str(data?.['pipelineId'])
        if (props.taskId) return taskId === props.taskId
        return pipelineId === props.pipelineId || (taskId !== undefined && ids.has(taskId))
      } catch {
        return false
      }
    }
    const refresh = () => {
      if (document.visibilityState !== 'visible') {
        missed.current = true
        return
      }
      if (pending.current) return
      pending.current = setTimeout(() => {
        pending.current = null
        router.refresh()
      }, THROTTLE_MS)
    }
    const onTask = (event: MessageEvent<string>) => {
      if (matches(event.data)) refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && missed.current) {
        missed.current = false
        refresh()
      }
    }
    const source = new EventSource('/api/live/stream')
    source.addEventListener('task', onTask)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      source.close()
      document.removeEventListener('visibilitychange', onVisibility)
      if (pending.current) clearTimeout(pending.current)
    }
  }, [props.taskId, props.pipelineId, taskIds, router])

  return null
}
