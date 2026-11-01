import type { RobotState } from '@/components/Robot'
import type { PipelineStatus, Stage, StageStatus } from '@/server/pipelines'

export const PIPELINE_LABEL: Record<PipelineStatus, string> = {
  running: 'Идёт',
  waiting: 'Ждёт вас',
  done: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Остановлен',
}

export const PIPELINE_CLASS: Record<PipelineStatus, string> = {
  running: 'bg-good/15 text-good',
  waiting: 'bg-warning/15 text-warning',
  done: 'bg-surface-2 text-text-2',
  failed: 'bg-critical/15 text-critical',
  cancelled: 'bg-surface-2 text-text-3',
}

export const STAGE_LABEL: Record<StageStatus, string> = {
  pending: 'впереди',
  running: 'в работе',
  waiting: 'ждёт вас',
  done: 'готово',
  approved: 'одобрено',
  failed: 'ошибка',
  skipped: 'пропущен',
}

export const stageRobotState = (stage: Stage, needsPermission: boolean): RobotState => {
  if (needsPermission) return 'waiting'
  const map: Record<StageStatus, RobotState> = {
    pending: 'offline',
    running: 'working',
    waiting: 'waiting',
    done: 'done',
    approved: 'done',
    failed: 'error',
    skipped: 'offline',
  }
  return map[stage.status]
}
