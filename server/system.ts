import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)
const CACHE_MS = 10_000

let cached: { at: number; percent: number } | undefined

// macOS reports reclaimable memory through memory_pressure; os.freemem() alone undercounts it
export const freeMemoryPercent = async (): Promise<number> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.percent
  let percent = Math.round((os.freemem() / os.totalmem()) * 100)
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run('memory_pressure', ['-Q'])
      const match = /free percentage:\s*(\d+)%/.exec(stdout)
      if (match?.[1]) percent = Number(match[1])
    } catch {
      // Fall back to os.freemem()
    }
  }
  cached = { at: Date.now(), percent }
  return percent
}
