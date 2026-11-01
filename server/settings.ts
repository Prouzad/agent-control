import { obj, str } from '@/lib/json'

import { db } from './db'

export const RUNNER_DEFAULTS = {
  maxParallel: 3,
  // Below this share of free RAM the dispatcher holds queued tasks
  minFreeMemoryPercent: 15,
}

const read = (key: string) =>
  str(obj(db().prepare('SELECT value FROM org_settings WHERE key = ?').get(key))?.['value'])

const write = (key: string, value: string) => {
  db()
    .prepare(
      'INSERT INTO org_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value)
}

const readInt = (key: string, fallback: number) => {
  const value = Number.parseInt(read(key) ?? '', 10)
  return Number.isFinite(value) ? value : fallback
}

export const runnerSettings = () => ({
  maxParallel: readInt('runner_max_parallel', RUNNER_DEFAULTS.maxParallel),
  minFreeMemoryPercent: readInt('runner_min_free_memory', RUNNER_DEFAULTS.minFreeMemoryPercent),
  // Agents may read the projects' .env files; changing them stays forbidden
  allowEnvRead: read('runner_allow_env_read') === '1',
  // Agents run like a terminal session: the person's claude, every tool, MCP server, skill and
  // setting; role tool lists stop limiting them
  terminalParity: read('runner_terminal_parity') !== '0',
  // In auto mode permission requests go to the architect and the lead (then the CTO) first
  permissionBoard: read('runner_permission_board') !== '0',
})

export const saveRunnerSettings = (input: {
  maxParallel: number
  minFreeMemoryPercent: number
  allowEnvRead: boolean
  terminalParity: boolean
  permissionBoard: boolean
}) => {
  write('runner_max_parallel', String(input.maxParallel))
  write('runner_min_free_memory', String(input.minFreeMemoryPercent))
  write('runner_allow_env_read', input.allowEnvRead ? '1' : '0')
  write('runner_terminal_parity', input.terminalParity ? '1' : '0')
  write('runner_permission_board', input.permissionBoard ? '1' : '0')
}
