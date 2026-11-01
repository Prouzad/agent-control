'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { addLesson, deleteLesson, updateLesson } from '@/server/lessons'

const roleOf = (value: FormDataEntryValue | null) => {
  const role = typeof value === 'string' ? value.trim() : ''
  return role || null
}

export const addLessonAction = async (projectId: string, form: FormData) => {
  const text = z
    .string()
    .trim()
    .min(3, 'Слишком коротко')
    .parse(form.get('text') ?? '')
  addLesson({ projectId, roleId: roleOf(form.get('roleId')), text, source: 'Добавлено вручную' })
  revalidatePath('/lessons')
}

export const saveLessonAction = async (id: number, form: FormData) => {
  const text = z
    .string()
    .trim()
    .min(3, 'Слишком коротко')
    .parse(form.get('text') ?? '')
  updateLesson(id, { text, roleId: roleOf(form.get('roleId')) })
  revalidatePath('/lessons')
}

export const pinLessonAction = async (id: number, pinned: boolean) => {
  updateLesson(id, { pinned })
  revalidatePath('/lessons')
}

export const archiveLessonAction = async (id: number, archived: boolean) => {
  updateLesson(id, { archived })
  revalidatePath('/lessons')
}

export const deleteLessonAction = async (id: number) => {
  deleteLesson(id)
  revalidatePath('/lessons')
}
