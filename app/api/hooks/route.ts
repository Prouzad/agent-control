import { obj } from '@/lib/json'
import { recordHook } from '@/server/hooks'

// Receives Claude Code hook payloads; always answers fast and never blocks the session
export const POST = async (request: Request) => {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return new Response(null, { status: 400 })
  }
  const event = obj(payload)
  if (!event || !recordHook(event)) return new Response(null, { status: 400 })
  return new Response(null, { status: 204 })
}
