import fs from 'node:fs'
import path from 'node:path'

import { arr, obj, str, type Json } from '@/lib/json'

export const HOOK_MARKER = 'agent-control-hook'
export const HOOK_URL = 'http://127.0.0.1:4400/api/hooks'

// Silent and non-blocking: a stopped dashboard must never slow down or fail a session
export const HOOK_COMMAND = `curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' --data-binary @- ${HOOK_URL} || true # ${HOOK_MARKER}`

export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
] as const

const settingsFile = (configDir: string) => path.join(configDir, 'settings.json')

const isOurs = (handler: unknown) => str(obj(handler)?.['command'])?.includes(HOOK_MARKER) === true

const readSettings = (configDir: string): Json => {
  const file = settingsFile(configDir)
  if (!fs.existsSync(file)) return {}
  const parsed = obj(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!parsed) throw new Error(`${file}: ожидался JSON-объект`)
  return parsed
}

// Drops our handlers, then any matcher group or event they leave empty; other hooks stay untouched
const withoutOurs = (hooks: Json): Json => {
  const result: Json = {}
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      result[event] = groups
      continue
    }
    const kept = groups.flatMap((group) => {
      const g = obj(group)
      if (!g) return [group]
      const handlers = arr(g['hooks'])
      const remaining = handlers.filter((h) => !isOurs(h))
      if (remaining.length === handlers.length) return [group]
      return remaining.length ? [{ ...g, hooks: remaining }] : []
    })
    if (kept.length) result[event] = kept
  }
  return result
}

const write = (configDir: string, settings: Json) => {
  const file = settingsFile(configDir)
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let backup = `${file}.bak-agent-control-${stamp}`
    // Two writes in the same millisecond must not overwrite each other's backup
    for (let n = 1; fs.existsSync(backup); n += 1)
      backup = `${file}.bak-agent-control-${stamp}-${n}`
    fs.copyFileSync(file, backup)
  }
  // Write-then-rename so a crash never leaves a half-written settings file
  const temp = `${file}.agent-control-tmp`
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`)
  fs.renameSync(temp, file)
}

export const installHooks = (configDir: string) => {
  const settings = readSettings(configDir)
  const hooks = withoutOurs(obj(settings['hooks']) ?? {})
  for (const event of HOOK_EVENTS) {
    const groups = arr(hooks[event])
    hooks[event] = [...groups, { hooks: [{ type: 'command', command: HOOK_COMMAND, async: true }] }]
  }
  write(configDir, { ...settings, hooks })
}

export const uninstallHooks = (configDir: string) => {
  const settings = readSettings(configDir)
  const current = obj(settings['hooks'])
  if (!current) return
  const hooks = withoutOurs(current)
  const next: Json = { ...settings, hooks }
  if (!Object.keys(hooks).length) delete next['hooks']
  write(configDir, next)
}

export type HookStatus =
  | { state: 'installed' | 'partial' | 'missing'; installed: number; total: number }
  | { state: 'error'; message: string }

export const hookStatus = (configDir: string): HookStatus => {
  try {
    const hooks = obj(readSettings(configDir)['hooks']) ?? {}
    const installed = HOOK_EVENTS.filter((event) =>
      arr(hooks[event]).some((group) => arr(obj(group)?.['hooks']).some(isOurs)),
    ).length
    const total = HOOK_EVENTS.length
    const state = installed === total ? 'installed' : installed ? 'partial' : 'missing'
    return { state, installed, total }
  } catch (error) {
    return { state: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
