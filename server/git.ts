import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { DATA_DIR } from './db'

const run = promisify(execFile)
const MAX_DIFF_BYTES = 400_000

const git = async (cwd: string, args: string[]) => {
  const { stdout } = await run('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

export const repoRoot = async (dir: string) => {
  try {
    return (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return undefined
  }
}

// Where a folder sits inside a worktree of its repo. git reports the repo root with symlinks
// resolved (/tmp → /private/tmp on macOS), so the folder is resolved the same way first
export const pathInWorktree = async (repo: string, worktree: string, dir: string) =>
  path.join(worktree, path.relative(repo, await fs.promises.realpath(dir)))

export const WORKTREES_DIR = path.join(DATA_DIR, 'worktrees')

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)

// A fresh branch and checkout per task, so agents never touch the user's working copy
// A fresh worktree has no .env files (git ignores them), so the branch's dev server could not
// reach its services. Each one is linked, never copied: the original stays the only file to change
const ENV_FILE = /^\.env(\..+)?$/
export const linkEnvFiles = async (from: string, to: string) => {
  const linked: string[] = []
  for (const name of await fs.promises.readdir(from)) {
    if (!ENV_FILE.test(name) || name === '.env.example') continue
    const target = path.join(to, name)
    if (fs.existsSync(target)) continue
    await fs.promises.symlink(path.join(from, name), target)
    linked.push(name)
  }
  return linked
}

export const createWorktree = async (repo: string, taskId: string, title: string) => {
  const short = taskId.slice(0, 8)
  const branch = `agent/${short}${slug(title) ? `-${slug(title)}` : ''}`
  const worktree = path.join(WORKTREES_DIR, short)
  fs.mkdirSync(WORKTREES_DIR, { recursive: true })
  await git(repo, ['worktree', 'add', '-b', branch, worktree, 'HEAD'])
  return { branch, worktree }
}

export const removeWorktree = async (repo: string, worktree: string, branch: string | null) => {
  await git(repo, ['worktree', 'remove', '--force', worktree])
  // Keep the branch if it has commits that are not merged anywhere else
  if (branch) await git(repo, ['branch', '-d', branch]).catch(() => undefined)
}

export type Diff = { stat: string; patch: string; truncated: boolean; untracked: string[] }

// Everything the agent changed in its checkout: commits on top of the base plus uncommitted edits
export const worktreeDiff = async (worktree: string, base: string): Promise<Diff> => {
  const stat = await git(worktree, ['diff', '--stat', base])
  const patch = await git(worktree, ['diff', base])
  const untracked = (await git(worktree, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .filter(Boolean)
  const truncated = patch.length > MAX_DIFF_BYTES
  return { stat, patch: truncated ? patch.slice(0, MAX_DIFF_BYTES) : patch, truncated, untracked }
}

// Only the summary: pages show it on every refresh, the patch itself loads when opened
export type DiffStat = { stat: string; untracked: string[] }
export const worktreeStat = async (worktree: string, base: string): Promise<DiffStat> => ({
  stat: await git(worktree, ['diff', '--stat', base]),
  untracked: (await git(worktree, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .filter(Boolean),
})

// How much the branch changed since its base: files, lines and commits
export const branchStats = async (worktree: string, base: string) => {
  const short = await git(worktree, ['diff', '--shortstat', base])
  const number = (pattern: RegExp) => Number(pattern.exec(short)?.[1] ?? 0)
  return {
    files: number(/(\d+) files? changed/),
    insertions: number(/(\d+) insertions?/),
    deletions: number(/(\d+) deletions?/),
    commits: Number((await git(worktree, ['rev-list', '--count', `${base}..HEAD`])).trim() || 0),
  }
}

export const headCommit = async (dir: string) => (await git(dir, ['rev-parse', 'HEAD'])).trim()
