'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createAccount, deleteAccount, listAccounts } from '@/server/accounts'
import { deleteApiKey, saveApiKey } from '@/server/keychain'
import { indexNow } from '@/server/indexer'

const schema = z
  .object({
    name: z.string().trim().min(1, 'Укажите название'),
    kind: z.enum(['subscription', 'api_key']),
    configDir: z
      .string()
      .trim()
      .transform((v) => v || null),
  })
  .refine((v) => v.kind !== 'subscription' || v.configDir, {
    message: 'Для подписки нужна папка конфигурации',
  })

export const createAccountAction = async (form: FormData) => {
  createAccount(
    schema.parse({
      name: form.get('name') ?? '',
      kind: form.get('kind') ?? '',
      configDir: form.get('configDir') ?? '',
    }),
  )
  // Pick up the new account's transcripts right away
  await indexNow()
  revalidatePath('/', 'layout')
}

export const saveApiKeyAction = async (id: string, form: FormData) => {
  const account = listAccounts().find((a) => a.id === id)
  if (account?.kind !== 'api_key') throw new Error('Ключ можно задать только аккаунту с API-ключом')
  const key = z
    .string()
    .trim()
    .regex(/^sk-ant-[\w-]+$/, 'Ключ Anthropic начинается с sk-ant-')
    .parse(form.get('key') ?? '')
  await saveApiKey(id, key)
  revalidatePath('/accounts')
}

export const deleteAccountAction = async (id: string) => {
  await deleteApiKey(id)
  deleteAccount(id)
  revalidatePath('/', 'layout')
}
