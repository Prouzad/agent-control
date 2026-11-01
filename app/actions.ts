'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

import { indexNow } from '@/server/indexer'
import { WORKSPACE_COOKIE } from '@/server/visibility'

export const reindex = async () => {
  await indexNow()
  revalidatePath('/', 'layout')
}

// The workspace lives in a cookie so every page and API route sees the same choice
export const setWorkspaceAction = async (projectId: string) => {
  const store = await cookies()
  if (projectId) {
    store.set(WORKSPACE_COOKIE, projectId, {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
    })
  } else {
    store.delete(WORKSPACE_COOKIE)
  }
  revalidatePath('/', 'layout')
}
