import { Select } from '@/components/Select'
import { STAGES } from '@/lib/pipelines'
import { MODELS, TOOLS } from '@/lib/roles'
import type { Role, Team } from '@/server/org'

type Props = {
  action: (form: FormData) => Promise<void>
  teams: Pick<Team, 'id' | 'name'>[]
  role?: Role
  defaultTeamId?: string
  submitLabel: string
}

const field = 'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text'
const label = 'flex flex-col gap-1 text-xs text-text-2'

export const RoleForm = (props: Props) => {
  const role = props.role
  return (
    <form action={props.action} className="grid gap-3 sm:grid-cols-2">
      {!role && (
        <label className={label}>
          Системное имя (имя файла агента)
          <input
            name="id"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder="frontend-reviewer"
            className={`${field} font-mono`}
          />
        </label>
      )}
      <label className={label}>
        Название роли
        <input name="title" required defaultValue={role?.title} className={field} />
      </label>
      <label className={label}>
        Команда
        <Select
          name="teamId"
          defaultValue={role?.teamId ?? props.defaultTeamId}
          options={props.teams.map((t) => ({ value: t.id, label: t.name }))}
        />
      </label>
      <label className={label}>
        Модель
        <Select
          name="model"
          defaultValue={role?.model ?? 'inherit'}
          options={MODELS.map((m) => ({ value: m.value, label: m.label }))}
        />
      </label>
      <label className={`${label} sm:col-span-2`}>
        Когда звать эту роль (одна строка)
        <input name="description" defaultValue={role?.description} className={field} />
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs text-text-2">Инструменты</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {TOOLS.map((tool) => (
            <label key={tool.name} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="tools"
                value={tool.name}
                defaultChecked={role ? role.tools.includes(tool.name) : tool.name === 'Read'}
                className="accent-accent"
              />
              <span>{tool.label}</span>
              <span className="font-mono text-xs text-text-3">{tool.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs text-text-2">
          Этапы конвейера, которые роль берёт на себя в проектах своей команды
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {STAGES.filter((stage) => stage.kind === 'agent').map((stage) => (
            <label key={stage.key} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="stages"
                value={stage.key}
                defaultChecked={role?.stages.includes(stage.key)}
                className="accent-accent"
              />
              <span>{stage.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={label}>
        Скиллы проекта (через запятую)
        <input
          name="skills"
          defaultValue={role?.skills.join(', ')}
          placeholder="lint, test"
          className={`${field} font-mono`}
        />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input
          type="checkbox"
          name="isLead"
          defaultChecked={role?.isLead}
          className="accent-accent"
        />
        Лид команды
      </label>
      <label className={`${label} sm:col-span-2`}>
        Промпт роли: зона ответственности, входы, выходы, где остановиться
        <textarea
          name="prompt"
          required
          rows={16}
          defaultValue={role?.prompt}
          className={`${field} font-mono text-xs leading-relaxed`}
        />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" className="btn-primary">
          {props.submitLabel}
        </button>
      </div>
    </form>
  )
}
