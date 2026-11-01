import { ImageTextarea } from '@/components/ImageTextarea'
import { Select } from '@/components/Select'
import { modelChoiceLabel, TASK_MODELS } from '@/lib/roles'
import { PERMISSION_MODE_LABEL, PRIORITY_LABEL } from '@/lib/taskStatus'
import type { Team } from '@/server/org'
import type { Task } from '@/server/tasks'

// Form value for «route through the CTO»; the action turns it into the router role
export const DISPATCH_ROLE = '__dispatch__'

type Props = {
  action: (form: FormData) => Promise<void>
  submitLabel: string
  projects: { id: string; label: string }[]
  teams: Pick<Team, 'id' | 'name' | 'roles'>[]
  // Editing an existing task fills the form and hides the queue checkbox
  task?: Task
}

const field = 'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text'
const label = 'flex flex-col gap-1 text-xs text-text-2'

export const TaskForm = (props: Props) => {
  const task = props.task
  return (
    <form action={props.action} className="grid gap-3 sm:grid-cols-2">
      <label className={`${label} sm:col-span-2`}>
        Что сделать
        <input
          name="title"
          required
          defaultValue={task?.title}
          className={field}
          placeholder="Добавить тёмную тему на страницу настроек"
        />
      </label>
      <label className={`${label} sm:col-span-2`}>
        Подробности, критерии готовности, ссылки
        <ImageTextarea
          name="description"
          rows={task ? 12 : 5}
          defaultValue={task?.description}
          className={field}
        />
      </label>
      <label className={label}>
        Проект
        <Select
          name="projectId"
          defaultValue={task?.projectId ?? props.projects[0]?.id}
          options={props.projects.map((p) => ({ value: p.id, label: p.label }))}
        />
      </label>
      <label className={label}>
        Роль агента
        <Select
          name="roleId"
          defaultValue={!task || task.dispatch ? DISPATCH_ROLE : (task.roleId ?? '')}
          options={[
            { value: DISPATCH_ROLE, label: 'CTO решит — раздаст лидам команд' },
            { value: '', label: 'Без роли (обычный Claude Code)' },
            ...props.teams.flatMap((team) =>
              team.roles.map((role) => ({ value: role.id, label: role.title, group: team.name })),
            ),
          ]}
        />
      </label>
      <label className={label}>
        Модель
        <Select
          name="model"
          defaultValue={task?.model ?? ''}
          options={[
            { value: '', label: 'Как у роли' },
            ...TASK_MODELS.map((m) => ({ value: m, label: modelChoiceLabel(m) })),
          ]}
        />
      </label>
      <label className={label}>
        Разрешения
        <Select
          name="permissionMode"
          defaultValue={task?.permissionMode ?? 'default'}
          options={Object.entries(PERMISSION_MODE_LABEL).map(([value, text]) => ({
            value,
            label: text,
          }))}
        />
      </label>
      <label className={label}>
        Где работать
        <Select
          name="isolation"
          defaultValue={task?.isolation ?? 'worktree'}
          options={[
            { value: 'worktree', label: 'Отдельный git worktree (безопасно)' },
            { value: 'in_place', label: 'Прямо в папке проекта' },
          ]}
        />
      </label>
      <label className={label}>
        Приоритет
        <Select
          name="priority"
          defaultValue={String(task?.priority ?? 1)}
          options={PRIORITY_LABEL.map((text, index) => ({ value: String(index), label: text }))}
        />
      </label>
      <label className={label}>
        Лимит стоимости, $ (необязательно)
        <input
          name="budgetUsd"
          inputMode="decimal"
          placeholder="5"
          defaultValue={task?.budgetUsd ?? ''}
          className={field}
        />
      </label>
      {!task && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="start" defaultChecked className="accent-accent" />
          Сразу в работу — иначе задача полежит в бэклоге, пока вы её не запустите
        </label>
      )}
      <div className="sm:col-span-2">
        <button type="submit" className="btn-primary">
          {props.submitLabel}
        </button>
      </div>
    </form>
  )
}
