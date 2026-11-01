import { PageHeader } from '@/components/ui'
import { liveSnapshot } from '@/server/live'
import { readView } from '@/server/visibility'

import { LiveBoard } from './LiveBoard'

const LivePage = async () => (
  <>
    <PageHeader
      title="Зал агентов"
      description="Что агенты делают прямо сейчас: текущий инструмент, субагенты и сессии, которые ждут вашего ответа"
    />
    <LiveBoard initial={liveSnapshot(await readView())} />
  </>
)

export default LivePage
