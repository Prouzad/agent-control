import { Select } from '@/components/Select'
import type { Account } from '@/server/accounts'

type Props = {
  action: (form: FormData) => Promise<void>
  submitLabel: string
  projects: { id: string; label: string }[]
  accounts: Account[]
  teams: { id: string; name: string }[]
  // Shown when the project has no teams of its own
  inheritedTeams?: string[]
  defaults?: {
    teamIds?: string[]
    name?: string
    path?: string | null
    parentId?: string | null
    accountId?: string | null
  }
}

const field = 'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text'
const label = 'flex flex-col gap-1 text-xs text-text-2'

export const ProjectForm = (props: Props) => (
  <form action={props.action} className="grid gap-3 sm:grid-cols-2">
    <label className={label}>
      Название
      <input name="name" required defaultValue={props.defaults?.name ?? ''} className={field} />
    </label>
    <label className={label}>
      Папка на диске
      <input
        name="path"
        placeholder="/Users/…/dev/my-workspace"
        defaultValue={props.defaults?.path ?? ''}
        className={`${field} font-mono`}
      />
    </label>
    <label className={label}>
      Родительский проект
      <Select
        name="parentId"
        defaultValue={props.defaults?.parentId ?? ''}
        options={[
          { value: '', label: '— верхний уровень —' },
          ...props.projects.map((p) => ({ value: p.id, label: p.label })),
        ]}
      />
    </label>
    <label className={label}>
      Аккаунт (подписка или API-ключ)
      <Select
        name="accountId"
        defaultValue={props.defaults?.accountId ?? ''}
        options={[
          { value: '', label: 'Наследовать от родителя' },
          ...props.accounts.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
    </label>
    <fieldset className="sm:col-span-2">
      <legend className="mb-1.5 text-xs text-text-2">
        Команды проекта
        {props.inheritedTeams?.length
          ? ` — пусто: наследуются от родителя (${props.inheritedTeams.join(', ')})`
          : ' — их роли берут этапы конвейеров проекта'}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {props.teams.map((team) => (
          <label key={team.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name="teamIds"
              value={team.id}
              defaultChecked={props.defaults?.teamIds?.includes(team.id)}
              className="accent-accent"
            />
            {team.name}
          </label>
        ))}
      </div>
    </fieldset>
    <div className="sm:col-span-2">
      <button type="submit" className="btn-primary">
        {props.submitLabel}
      </button>
    </div>
  </form>
)
