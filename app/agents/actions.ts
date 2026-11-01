'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { STAGES } from '@/lib/pipelines'
import { isModelChoice, TOOLS } from '@/lib/roles'
import { createRole, deleteRole, getRole, ROLE_ID_PATTERN, updateRole } from '@/server/org'

const toolNames: string[] = TOOLS.map((t) => t.name)
const stageKeys: string[] = STAGES.filter((s) => s.kind === 'agent').map((s) => s.key)

const schema = z.object({
  teamId: z.string().min(1),
  title: z.string().trim().min(1, 'Укажите название роли'),
  description: z.string().trim(),
  model: z.string().refine(isModelChoice, 'Неизвестная модель'),
  tools: z.array(z.string().refine((t) => toolNames.includes(t))),
  skills: z.string().transform((v) =>
    v
      .split(/[\s,]+/)
      .map((s) => s.replace(/^\//, '').trim())
      .filter(Boolean),
  ),
  isLead: z.boolean(),
  prompt: z.string().trim().min(1, 'Промпт не может быть пустым'),
  stages: z.array(z.string().refine((key) => stageKeys.includes(key))),
})

const read = (form: FormData) =>
  schema.parse({
    teamId: form.get('teamId') ?? '',
    title: form.get('title') ?? '',
    description: form.get('description') ?? '',
    model: form.get('model') ?? 'inherit',
    tools: form.getAll('tools'),
    skills: form.get('skills') ?? '',
    isLead: form.get('isLead') === 'on',
    prompt: form.get('prompt') ?? '',
    stages: form.getAll('stages'),
  })

const revalidate = (teamIds: string[]) => {
  revalidatePath('/agents', 'layout')
  revalidatePath('/teams')
  teamIds.forEach((id) => revalidatePath(`/teams/${id}`))
}

export const createRoleAction = async (form: FormData) => {
  const id = z
    .string()
    .trim()
    .regex(ROLE_ID_PATTERN)
    .parse(form.get('id') ?? '')
  const input = read(form)
  createRole({ id, ...input })
  revalidate([input.teamId])
  redirect(`/agents/${id}`)
}

export const updateRoleAction = async (id: string, form: FormData) => {
  const previousTeam = getRole(id)?.teamId
  const input = read(form)
  updateRole(id, input)
  revalidate([input.teamId, ...(previousTeam ? [previousTeam] : [])])
}

export const deleteRoleAction = async (id: string) => {
  const teamId = getRole(id)?.teamId
  deleteRole(id)
  revalidate(teamId ? [teamId] : [])
  redirect(teamId ? `/teams/${teamId}` : '/agents')
}
