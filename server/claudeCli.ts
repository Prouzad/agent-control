import { spawn } from 'node:child_process'
import fs from 'node:fs'

// The claude the person runs in their terminal. Agents use the same binary, so they get the
// same version, tools and features; the SDK's bundled copy lags behind and lacks some of them
let found: Promise<string | null> | null = null

const LOOKUP_TIMEOUT_MS = 15_000

// An interactive shell, as in the terminal: version managers such as nvm load only there, and a
// login shell alone can find an older copy first. It runs in its own session with no terminal,
// so it can never stop on terminal access, and it is killed outright if it hangs
const lookup = () =>
  new Promise<string | null>((resolve) => {
    const shell = spawn('/bin/zsh', ['-ilc', 'command -v claude'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = ''
    shell.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const timer = setTimeout(() => {
      if (shell.pid) process.kill(-shell.pid, 'SIGKILL')
      resolve(null)
    }, LOOKUP_TIMEOUT_MS)
    shell.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    shell.on('close', () => {
      clearTimeout(timer)
      const last = output.trim().split('\n').pop() ?? ''
      try {
        resolve(last.startsWith('/') ? fs.realpathSync(last) : null)
      } catch {
        resolve(null)
      }
    })
  })

export const terminalClaudePath = () => {
  found ??= lookup()
  return found
}
