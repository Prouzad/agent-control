import { liveSnapshot } from '@/server/live'
import { readView } from '@/server/visibility'

export const dynamic = 'force-dynamic'

export const GET = async () => Response.json(liveSnapshot(await readView()))
