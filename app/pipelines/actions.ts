'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { STAGES, TEMPLATES } from '@/lib/pipelines'
import {
  approveStage,
  archivePipeline,
  cancelPipeline,
  createPipeline,
  getPipeline,
  deletePipeline,
  rejectStage,
  retryStage,
  reworkAgain,
  sayToPipeline,
  setPipelinePermissionMode,
  unarchivePipeline,
} from '@/server/pipelines'
import { repoRoot } from '@/server/git'
import { generateReport, setReportAuto } from '@/server/report'
import { accountEnv } from '@/server/runner'
import { getProject, projectWorkPath } from '@/server/projects'
import { isPermissionMode } from '@/server/tasks'

const stageKeys: string[] = STAGES.map((s) => s.key)

const schema = z.object({
  title: z.string().trim().min(1, 'Укажите задачу'),
  description: z.string().trim(),
  projectId: z.string().min(1, 'Выберите проект'),
  template: z.string(),
  stageKeys: z
    .array(z.string().refine((k) => stageKeys.includes(k)))
    .min(1, 'Нужен хотя бы один этап'),
  devRoleId: z
    .string()
    .trim()
    .transform((v) => v || null),
  permissionMode: z.string().refine(isPermissionMode),
  stageBudgetUsd: z
    .string()
    .trim()
    .transform((v) => (v ? Number(v.replace(',', '.')) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0), 'Бюджет — положительное число'),
})

const refresh = (id?: string) => {
  revalidatePath('/pipelines')
  revalidatePath('/tasks')
  if (id) revalidatePath(`/pipelines/${id}`)
}

export type PipelineFormState = { error: string } | null

export const createPipelineAction = async (
  _previous: PipelineFormState,
  form: FormData,
): Promise<PipelineFormState> => {
  const input = schema.parse({
    title: form.get('title') ?? '',
    description: form.get('description') ?? '',
    projectId: form.get('projectId') ?? '',
    template: form.get('template') ?? 'custom',
    stageKeys: form.getAll('stages'),
    devRoleId: form.get('devRoleId') ?? '',
    permissionMode: form.get('permissionMode') ?? 'default',
    stageBudgetUsd: form.get('stageBudgetUsd') ?? '',
  })
  // Keep the canonical stage order whatever order the checkboxes arrived in
  const ordered = stageKeys.filter((key) => input.stageKeys.includes(key))
  const permissionMode = isPermissionMode(input.permissionMode) ? input.permissionMode : 'default'
  const template = TEMPLATES.find((t) => t.key === input.template)?.key ?? 'custom'
  // Every stage works on one branch of one repository, so the project must be a git repo
  const project = getProject(input.projectId)
  const dir = projectWorkPath(input.projectId)
  if (!dir || !(await repoRoot(dir))) {
    return {
      error: `«${project?.name ?? 'Проект'}» — не git-репозиторий (${dir ?? 'нет папки'}). Конвейеру нужен один репозиторий: выберите подпроект, который сам является git-репозиторием.`,
    }
  }
  const id = createPipeline({ ...input, stageKeys: ordered, permissionMode, template })
  refresh()
  redirect(`/pipelines/${id}`)
}

export const approveStageAction = async (pipelineId: string, stageId: string) => {
  approveStage(stageId)
  refresh(pipelineId)
}

export const rejectStageAction = async (pipelineId: string, stageId: string, form: FormData) => {
  const comment = z
    .string()
    .trim()
    .min(1, 'Напишите, что не так')
    .parse(form.get('comment') ?? '')
  rejectStage(stageId, comment)
  refresh(pipelineId)
}

export const reworkAgainAction = async (pipelineId: string, stageId: string, form: FormData) => {
  const comment = z
    .string()
    .trim()
    .parse(form.get('comment') ?? '')
  reworkAgain(stageId, comment)
  refresh(pipelineId)
}

export const retryStageAction = async (pipelineId: string, stageId: string) => {
  retryStage(stageId)
  refresh(pipelineId)
}

export const cancelPipelineAction = async (pipelineId: string) => {
  await cancelPipeline(pipelineId)
  refresh(pipelineId)
}

export const deletePipelineAction = async (pipelineId: string) => {
  await deletePipeline(pipelineId)
  refresh()
  redirect('/pipelines')
}

export const sayToPipelineAction = async (pipelineId: string, form: FormData) => {
  const text = z
    .string()
    .trim()
    .min(1)
    .parse(form.get('text') ?? '')
  sayToPipeline(pipelineId, text)
  refresh(pipelineId)
}

export const setPipelineModeAction = async (pipelineId: string, mode: string) => {
  if (!isPermissionMode(mode)) return
  await setPipelinePermissionMode(pipelineId, mode)
  refresh(pipelineId)
}

export const generateReportAction = async (
  pipelineId: string,
): Promise<{ error: string | null }> => {
  const pipeline = getPipeline(pipelineId)
  if (!pipeline?.projectId) return { error: 'У конвейера нет проекта' }
  try {
    await generateReport(pipeline, await accountEnv(pipeline.projectId))
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  revalidatePath(`/pipelines/${pipelineId}/report`)
  return { error: null }
}

export const setReportAutoAction = async (pipelineId: string, on: boolean) => {
  setReportAuto(pipelineId, on)
  revalidatePath(`/pipelines/${pipelineId}/report`)
}

export const archivePipelineAction = async (pipelineId: string) => {
  archivePipeline(pipelineId)
  revalidatePath('/pipelines', 'layout')
}

export const unarchivePipelineAction = async (pipelineId: string) => {
  unarchivePipeline(pipelineId)
  revalidatePath('/pipelines', 'layout')
}
