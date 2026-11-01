'use client'

import { ImageTextarea } from '@/components/ImageTextarea'
import { Hand } from 'lucide-react'
import { useActionState, useState } from 'react'

import { Select } from '@/components/Select'
import type { PipelineFormState } from '@/app/pipelines/actions'
import { STAGES, TEMPLATES } from '@/lib/pipelines'
import { PERMISSION_MODE_LABEL } from '@/lib/taskStatus'

type Option = { id: string; label: string }

type Props = {
  action: (previous: PipelineFormState, form: FormData) => Promise<PipelineFormState>
  projects: Option[]
  devRoles: { team: string; roles: Option[] }[]
  // Prefill when a task is turned into a pipeline
  defaults?: { title: string; description: string; projectId: string | null }
}

const field = 'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text'
const label = 'flex flex-col gap-1 text-xs text-text-2'

export const PipelineForm = (props: Props) => {
  const [state, formAction, pending] = useActionState(props.action, null)
  const [template, setTemplate] = useState<string>(TEMPLATES[0].key)
  const [stages, setStages] = useState<string[]>([...TEMPLATES[0].stages])

  // A template is a preset of stages; editing the checkboxes turns it into a custom set
  const applyTemplate = (key: string) => {
    setTemplate(key)
    const preset = TEMPLATES.find((t) => t.key === key)
    if (preset) setStages([...preset.stages])
  }

  const toggle = (key: string, on: boolean) => {
    setTemplate('custom')
    setStages((current) => (on ? [...current, key] : current.filter((k) => k !== key)))
  }

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="template" value={template} />
      <label className={`${label} sm:col-span-2`}>
        Что сделать
        <input
          name="title"
          required
          defaultValue={props.defaults?.title}
          className={field}
          placeholder="Тёмная тема на странице настроек"
        />
      </label>
      <label className={`${label} sm:col-span-2`}>
        Описание задачи, ссылки на ТЗ и макеты
        <ImageTextarea
          name="description"
          rows={props.defaults ? 10 : 5}
          defaultValue={props.defaults?.description}
          className={field}
        />
      </label>
      <label className={label}>
        Проект
        <Select
          name="projectId"
          defaultValue={props.defaults?.projectId ?? props.projects[0]?.id}
          options={props.projects.map((p) => ({ value: p.id, label: p.label }))}
        />
      </label>
      <label className={label}>
        Кто разрабатывает
        <Select
          name="devRoleId"
          defaultValue=""
          options={[
            { value: '', label: 'Из команд проекта (иначе Lead Frontend)' },
            ...props.devRoles.flatMap((group) =>
              group.roles.map((role) => ({ value: role.id, label: role.label, group: group.team })),
            ),
          ]}
        />
      </label>
      <label className={label}>
        Шаблон
        <Select
          value={template}
          onChange={applyTemplate}
          options={[
            ...TEMPLATES.map((t) => ({ value: t.key, label: t.label })),
            { value: 'custom', label: 'Свой набор этапов' },
          ]}
        />
      </label>
      <label className={label}>
        Разрешения агентов
        <Select
          name="permissionMode"
          defaultValue="default"
          options={Object.entries(PERMISSION_MODE_LABEL).map(([value, text]) => ({
            value,
            label: text,
          }))}
        />
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs text-text-2">Этапы, по порядку</legend>
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {STAGES.map((stage) => (
            <li key={stage.key}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="stages"
                  value={stage.key}
                  checked={stages.includes(stage.key)}
                  onChange={(e) => toggle(stage.key, e.target.checked)}
                  className="accent-accent"
                />
                {stage.kind === 'gate' && (
                  <Hand size={13} className="text-warning" aria-label="Гейт" />
                )}
                {stage.label}
              </label>
            </li>
          ))}
        </ol>
      </fieldset>
      <label className={label}>
        Лимит стоимости на этап, $ (необязательно)
        <input name="stageBudgetUsd" inputMode="decimal" placeholder="3" className={field} />
      </label>
      {state?.error && (
        <p
          role="alert"
          className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical sm:col-span-2"
        >
          {state.error}
        </p>
      )}
      <div className="flex items-end sm:col-span-2">
        <button type="submit" disabled={!stages.length || pending} className="btn-primary">
          {pending ? 'Запускаю…' : 'Запустить конвейер'}
        </button>
      </div>
    </form>
  )
}
