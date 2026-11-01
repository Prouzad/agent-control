import os from 'node:os'
import path from 'node:path'

import { str, type Json } from './json'

const resolveFrom = (cwd: string | undefined, value: string) => {
  const expanded = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value
  if (path.isAbsolute(expanded)) return path.normalize(expanded)
  return cwd ? path.resolve(cwd, expanded) : undefined
}

// `cd dir && …`, `git -C dir …`, `npm --prefix dir …` name the folder a shell command works in
const COMMAND_DIR = [
  /(?:^|&&|;|\|\||\()\s*cd\s+(["']?)([^\s"';&|)]+)\1/,
  /\bgit\s+-C\s+(["']?)([^\s"';&|)]+)\1/,
  /--prefix[=\s]+(["']?)([^\s"';&|)]+)\1/,
]

const commandDir = (command: string) => {
  for (const pattern of COMMAND_DIR) {
    const dir = pattern.exec(command)?.[2]
    if (dir) return dir
  }
  return undefined
}

// The absolute file or folder a tool call acted on, when it can be told from the input
export const targetPath = (input: Json | undefined, cwd: string | undefined) => {
  if (!input) return null
  const direct = str(input['file_path']) ?? str(input['notebook_path']) ?? str(input['path'])
  const command = str(input['command'])
  const raw = direct ?? (command ? commandDir(command) : undefined)
  return raw ? (resolveFrom(cwd, raw) ?? null) : null
}
