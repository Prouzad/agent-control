import { bus } from '@/server/bus'

export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 25_000

// Server-sent events: `hook` per hook event, `index` when transcripts re-index, `task` when a task changes
export const GET = (request: Request) => {
  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream({
    start: (controller) => {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      const onHook = (event: unknown) => send(`event: hook\ndata: ${JSON.stringify(event)}\n\n`)
      const onIndex = () => send('event: index\ndata: {}\n\n')
      const onTask = (event: unknown) => send(`event: task\ndata: ${JSON.stringify(event)}\n\n`)
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)

      bus().on('hook', onHook)
      bus().on('index', onIndex)
      bus().on('task', onTask)
      cleanup = () => {
        clearInterval(heartbeat)
        bus().off('hook', onHook)
        bus().off('index', onIndex)
        bus().off('task', onTask)
      }
      request.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // Already closed by the runtime
        }
      })
      send(': connected\n\n')
    },
    cancel: () => cleanup(),
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
