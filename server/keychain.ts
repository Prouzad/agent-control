import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const SERVICE = 'agent-control'

// API keys live in the macOS login keychain, never in the database
export const saveApiKey = async (accountId: string, key: string) => {
  await run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', accountId, '-w', key])
}

export const readApiKey = async (accountId: string): Promise<string | undefined> => {
  try {
    const { stdout } = await run('security', [
      'find-generic-password',
      '-s',
      SERVICE,
      '-a',
      accountId,
      '-w',
    ])
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export const hasApiKey = async (accountId: string) => (await readApiKey(accountId)) !== undefined

export const deleteApiKey = async (accountId: string) => {
  try {
    await run('security', ['delete-generic-password', '-s', SERVICE, '-a', accountId])
  } catch {
    // Nothing stored
  }
}
