'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { listAccounts } from '@/server/accounts'
import { installHooks, uninstallHooks } from '@/server/hookInstall'
import { setProjectHidden } from '@/server/projects'
import { tick } from '@/server/runner'
import { saveRunnerSettings } from '@/server/settings'

const configDirOf = (accountId: string) => {
  const dir = listAccounts().find((a) => a.id === accountId)?.configDir
  if (!dir) throw new Error('У аккаунта нет папки конфигурации')
  return dir
}

export const installHooksAction = async (accountId: string) => {
  installHooks(configDirOf(accountId))
  revalidatePath('/settings')
}

export const uninstallHooksAction = async (accountId: string) => {
  uninstallHooks(configDirOf(accountId))
  revalidatePath('/settings')
}

export const saveRunnerSettingsAction = async (form: FormData) => {
  const input = z
    .object({
      maxParallel: z.coerce.number().int().min(1).max(10),
      minFreeMemoryPercent: z.coerce.number().int().min(0).max(90),
      allowEnvRead: z.boolean(),
      terminalParity: z.boolean(),
      permissionBoard: z.boolean(),
    })
    .parse({
      maxParallel: form.get('maxParallel') ?? '',
      minFreeMemoryPercent: form.get('minFreeMemoryPercent') ?? '',
      allowEnvRead: form.get('allowEnvRead') === 'on',
      terminalParity: form.get('terminalParity') === 'on',
      permissionBoard: form.get('permissionBoard') === 'on',
    })
  saveRunnerSettings(input)
  void tick()
  revalidatePath('/settings')
  revalidatePath('/tasks')
}

export const setProjectHiddenAction = async (projectId: string, hidden: boolean) => {
  setProjectHidden(projectId, hidden)
  revalidatePath('/', 'layout')
}
