'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createTeam, deleteTeam, setCommonRules, updateTeam } from '@/server/org'

const teamSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название'),
  description: z.string().trim(),
  delegate: z.boolean(),
})

const readTeam = (form: FormData) =>
  teamSchema.parse({
    name: form.get('name') ?? '',
    description: form.get('description') ?? '',
    delegate: form.get('delegate') === 'on',
  })

export const createTeamAction = async (form: FormData) => {
  const id = createTeam(readTeam(form))
  revalidatePath('/teams')
  redirect(`/teams/${id}`)
}

export const updateTeamAction = async (id: string, form: FormData) => {
  updateTeam(id, readTeam(form))
  revalidatePath('/teams')
  revalidatePath(`/teams/${id}`)
}

export const deleteTeamAction = async (id: string) => {
  deleteTeam(id)
  revalidatePath('/teams')
  redirect('/teams')
}

export const saveCommonRulesAction = async (form: FormData) => {
  setCommonRules(
    z
      .string()
      .trim()
      .min(1)
      .parse(form.get('rules') ?? ''),
  )
  revalidatePath('/teams')
  revalidatePath('/agents', 'layout')
}
