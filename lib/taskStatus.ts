import type { RobotState } from '@/components/Robot'
import type { Task, TaskStatus } from '@/server/tasks'

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: 'В бэклоге',
  todo: 'В очереди',
  running: 'Работает',
  waiting: 'Ждёт вас',
  review: 'На проверке',
  done: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Остановлена',
}

export const STATUS_CLASS: Record<TaskStatus, string> = {
  inbox: 'bg-surface-2 text-text-2',
  todo: 'bg-accent-soft text-accent',
  running: 'bg-good/15 text-good',
  waiting: 'bg-warning/15 text-warning',
  review: 'bg-accent-soft text-accent',
  done: 'bg-surface-2 text-text-2',
  failed: 'bg-critical/15 text-critical',
  cancelled: 'bg-surface-2 text-text-3',
}

// The board follows the work: backlog → the CTO splits it → To Do → assignees work → review → done
export const BOARD = [
  { key: 'backlog', label: 'Бэклог', hint: 'Новые задачи' },
  { key: 'cto', label: 'У CTO', hint: 'Разбирает и раздаёт' },
  { key: 'todo', label: 'To Do', hint: 'Ждут исполнителя' },
  { key: 'active', label: 'В работе', hint: 'Исполнитель работает' },
  { key: 'review', label: 'На проверке', hint: 'Нужен ваш взгляд' },
  { key: 'done', label: 'Готово', hint: '' },
] as const

export type BoardColumn = (typeof BOARD)[number]['key']

const BY_STATUS: Record<TaskStatus, BoardColumn> = {
  inbox: 'backlog',
  todo: 'todo',
  running: 'active',
  waiting: 'active',
  review: 'review',
  failed: 'review',
  done: 'done',
  cancelled: 'done',
}

// Hand-offs the CTO has not had approved yet stay inside its card, off the board
export const boardColumn = (task: Pick<Task, 'status' | 'dispatch' | 'parentId'>) => {
  if (task.parentId && task.status === 'inbox') return null
  if (task.status === 'failed') return 'review'
  if (task.dispatch === 'planning') return task.status === 'inbox' ? 'backlog' : 'cto'
  if (task.dispatch === 'approval') return 'cto'
  if (task.dispatch === 'running' || task.dispatch === 'collecting') return 'active'
  return BY_STATUS[task.status]
}

export const PRIORITY_LABEL = ['Низкий', 'Обычный', 'Высокий', 'Срочно']

export const PERMISSION_MODE_LABEL = {
  default: 'Спрашивать разрешения',
  acceptEdits: 'Правки файлов без вопросов',
  auto: 'Авто — безопасное сам, рискованное спросит',
  plan: 'Только план, без правок',
} as const

// How a task's robot looks: a pending permission request beats every other status
export const taskRobotState = (status: TaskStatus, needsPermission: boolean): RobotState => {
  if (needsPermission) return 'waiting'
  const map: Record<TaskStatus, RobotState> = {
    inbox: 'offline',
    todo: 'idle',
    running: 'working',
    waiting: 'waiting',
    review: 'done',
    done: 'done',
    failed: 'error',
    cancelled: 'offline',
  }
  return map[status]
}
