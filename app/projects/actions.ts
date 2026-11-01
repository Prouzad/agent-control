'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createProject, deleteProject, updateProject } from '@/server/projects'

const optional = z
  .string()
  .trim()
  .transform((v) => v || null)

const schema = z.object({
  name: z.string().trim().min(1, 'Укажите название'),
  path: optional,
  parentId: optional,
  accountId: optional,
  teamIds: z.array(z.string().min(1)),
})

const read = (form: FormData) =>
  schema.parse({
    name: form.get('name') ?? '',
    path: form.get('path') ?? '',
    parentId: form.get('parentId') ?? '',
    accountId: form.get('accountId') ?? '',
    teamIds: form.getAll('teamIds'),
  })

export const createProjectAction = async (form: FormData) => {
  createProject(read(form))
  revalidatePath('/', 'layout')
  redirect('/projects')
}

export const updateProjectAction = async (id: string, form: FormData) => {
  updateProject(id, read(form))
  revalidatePath('/', 'layout')
}

export const deleteProjectAction = async (id: string) => {
  deleteProject(id)
  revalidatePath('/', 'layout')
  redirect('/projects')
}
