import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { obj, str } from '@/lib/json'

import { db, now } from './db'
import { WORKTREES_DIR } from './git'
import { byProject } from './queries'

export type Project = {
  id: string
  parentId: string | null
  name: string
  path: string | null
  accountId: string | null
  // Set on the project itself; its sub-projects are hidden with it
  hidden: boolean
}

export type ProjectNode = Project & {
  depth: number
  // Own account, or the nearest ancestor's
  effectiveAccountId: string | null
  children: ProjectNode[]
}

const toProject = (row: unknown): Project | undefined => {
  const r = obj(row)
  const id = str(r?.['id'])
  const name = str(r?.['name'])
  if (!r || !id || !name) return undefined
  return {
    id,
    name,
    parentId: str(r['parent_id']) ?? null,
    path: str(r['path']) ?? null,
    accountId: str(r['account_id']) ?? null,
    hidden: r['hidden'] === 1,
  }
}

export const listProjects = (): Project[] =>
  db()
    .prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE')
    .all()
    .flatMap((row) => toProject(row) ?? [])

export const projectTree = (): ProjectNode[] => {
  const projects = listProjects()
  const build = (parentId: string | null, depth: number, inherited: string | null): ProjectNode[] =>
    projects
      .filter((p) => p.parentId === parentId)
      .map((p) => {
        const effectiveAccountId = p.accountId ?? inherited
        return {
          ...p,
          depth,
          effectiveAccountId,
          children: build(p.id, depth + 1, effectiveAccountId),
        }
      })
  return build(null, 0, null)
}

export const flattenTree = (nodes: ProjectNode[]): ProjectNode[] =>
  nodes.flatMap((node) => [node, ...flattenTree(node.children)])

// Ids of a project and all its descendants
export const projectWithDescendants = (id: string): string[] => {
  const projects = listProjects()
  const collect = (parentId: string): string[] => [
    parentId,
    ...projects.filter((p) => p.parentId === parentId).flatMap((p) => collect(p.id)),
  ]
  return collect(id)
}

const normalizePath = (value: string) => path.resolve(value.trim()).replace(/\/+$/, '')

// A session belongs to the project with the longest path that contains its cwd
// A session belongs to the project whose files it touched most (deepest project wins a tie);
// a session that touched no project files falls back to the project of its cwd.
// Pass session ids to limit the work to sessions that changed.
export const assignSessionProjects = (sessionIds?: string[]) => {
  const roots = listProjects()
    .flatMap((p) => (p.path ? [{ id: p.id, path: p.path }] : []))
    .sort((a, b) => b.path.length - a.path.length)
  const depth = new Map(roots.map((r) => [r.id, r.path.length]))
  // Agent sessions run in dashboard worktrees, outside every project folder
  const worktreeProject = new Map(
    db()
      .prepare(
        `SELECT worktree_path, project_id FROM tasks WHERE worktree_path IS NOT NULL AND project_id IS NOT NULL
         UNION SELECT worktree_path, project_id FROM pipelines WHERE worktree_path IS NOT NULL AND project_id IS NOT NULL`,
      )
      .all()
      .flatMap((row) => {
        const r = obj(row)
        const dir = str(r?.['worktree_path'])
        const projectId = str(r?.['project_id'])
        return dir && projectId ? [[dir, projectId] as const] : []
      }),
  )
  const worktreeOf = (cwd: string) =>
    [...worktreeProject].find(([dir]) => cwd === dir || cwd.startsWith(`${dir}/`))?.[1]
  const rootOf = (target: string) =>
    roots.find((root) => target === root.path || target.startsWith(`${root.path}/`))?.id

  const sessions = (
    sessionIds
      ? sessionIds.map((id) => db().prepare('SELECT id, cwd FROM sessions WHERE id = ?').get(id))
      : db().prepare('SELECT id, cwd FROM sessions').all()
  ).map(obj)
  const targets = db().prepare(
    `SELECT target_path, COUNT(*) AS n FROM tool_calls
     WHERE session_id = ? AND target_path IS NOT NULL GROUP BY target_path`,
  )
  const clear = db().prepare('DELETE FROM session_projects WHERE session_id = ?')
  const insert = db().prepare(
    'INSERT INTO session_projects (session_id, project_id, touches) VALUES (?, ?, ?)',
  )
  const update = db().prepare('UPDATE sessions SET project_id = ? WHERE id = ?')

  db().transaction(() => {
    for (const session of sessions) {
      const id = str(session?.['id'])
      if (!id) continue
      const touches = new Map<string, number>()
      for (const row of targets.all(id).map(obj)) {
        const projectId = rootOf(str(row?.['target_path']) ?? '')
        if (projectId) touches.set(projectId, (touches.get(projectId) ?? 0) + Number(row?.['n']))
      }
      clear.run(id)
      touches.forEach((count, projectId) => insert.run(id, projectId, count))
      const ranked = [...touches].sort(
        (a, b) => b[1] - a[1] || (depth.get(b[0]) ?? 0) - (depth.get(a[0]) ?? 0),
      )
      const cwd = str(session?.['cwd'])
      update.run(ranked[0]?.[0] ?? (cwd ? (worktreeOf(cwd) ?? rootOf(cwd)) : undefined) ?? null, id)
    }
  })()
}

export type TouchedProject = { projectId: string; name: string; touches: number }

export const sessionTouchedProjects = (sessionId: string): TouchedProject[] =>
  db()
    .prepare(
      `SELECT sp.project_id, p.name, sp.touches FROM session_projects sp
       JOIN projects p ON p.id = sp.project_id
       WHERE sp.session_id = ? ORDER BY sp.touches DESC`,
    )
    .all(sessionId)
    .flatMap((row) => {
      const r = obj(row)
      const projectId = str(r?.['project_id'])
      const name = str(r?.['name'])
      return projectId && name ? [{ projectId, name, touches: Number(r?.['touches']) }] : []
    })

export type ProjectInput = {
  name: string
  path: string | null
  parentId: string | null
  accountId: string | null
  // Empty means: inherit the parent's teams
  teamIds: string[]
}

// Teams chosen for the project itself (not inherited)
export const ownTeamIds = (projectId: string): string[] =>
  db()
    .prepare('SELECT team_id FROM project_teams WHERE project_id = ? ORDER BY rowid')
    .all(projectId)
    .flatMap((row) => str(obj(row)?.['team_id']) ?? [])

// The project's own teams, or the nearest ancestor's when it has none
export const effectiveTeamIds = (projectId: string): string[] => {
  const projects = listProjects()
  let current = projects.find((p) => p.id === projectId)
  while (current) {
    const own = ownTeamIds(current.id)
    if (own.length) return own
    const parentId = current.parentId
    current = parentId ? projects.find((p) => p.id === parentId) : undefined
  }
  return []
}

const setProjectTeams = (projectId: string, teamIds: string[]) => {
  db().prepare('DELETE FROM project_teams WHERE project_id = ?').run(projectId)
  const insert = db().prepare('INSERT INTO project_teams (project_id, team_id) VALUES (?, ?)')
  for (const teamId of new Set(teamIds)) insert.run(projectId, teamId)
}

export const createProject = (input: ProjectInput) => {
  const id = randomUUID()
  db()
    .prepare(
      'INSERT INTO projects (id, parent_id, name, path, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      input.parentId,
      input.name.trim(),
      input.path ? normalizePath(input.path) : null,
      input.accountId,
      now(),
    )
  setProjectTeams(id, input.teamIds)
  assignSessionProjects()
  return id
}

export const updateProject = (id: string, input: ProjectInput) => {
  // A project cannot become a child of itself or of its own descendant
  if (input.parentId && projectWithDescendants(id).includes(input.parentId)) {
    throw new Error('Нельзя вложить проект сам в себя')
  }
  db()
    .prepare('UPDATE projects SET parent_id = ?, name = ?, path = ?, account_id = ? WHERE id = ?')
    .run(
      input.parentId,
      input.name.trim(),
      input.path ? normalizePath(input.path) : null,
      input.accountId,
      id,
    )
  setProjectTeams(id, input.teamIds)
  assignSessionProjects()
}

export const deleteProject = (id: string) => {
  db().prepare('DELETE FROM projects WHERE id = ?').run(id)
  assignSessionProjects()
}

export type UnassignedFolder = { cwd: string; sessions: number; lastAt: string | null }

export const unassignedFolders = (): UnassignedFolder[] =>
  db()
    .prepare(
      `SELECT cwd, COUNT(*) AS sessions, MAX(ended_at) AS last_at FROM sessions
       WHERE project_id IS NULL AND cwd IS NOT NULL AND cwd NOT LIKE ?
       GROUP BY cwd ORDER BY sessions DESC`,
    )
    .all(`${WORKTREES_DIR}/%`)
    .flatMap((row) => {
      const r = obj(row)
      const cwd = str(r?.['cwd'])
      return cwd
        ? [{ cwd, sessions: Number(r?.['sessions'] ?? 0), lastAt: str(r?.['last_at']) ?? null }]
        : []
    })

// Flat, indented list for selects
export const projectOptions = () =>
  flattenTree(projectTree()).map((p) => ({
    id: p.id,
    label: `${'  '.repeat(p.depth)}${p.depth ? '└ ' : ''}${p.name}`,
  }))

export const projectNames = () => new Map(listProjects().map((p) => [p.id, p.name]))

export const getProject = (id: string) => listProjects().find((p) => p.id === id)

// The project's own account, else the nearest ancestor's, else the default account
export const effectiveAccountId = (projectId: string): string => {
  const projects = listProjects()
  let current = projects.find((p) => p.id === projectId)
  while (current) {
    if (current.accountId) return current.accountId
    const parentId = current.parentId
    current = parentId ? projects.find((p) => p.id === parentId) : undefined
  }
  return 'default'
}

// Sessions and cost of a project together with its sub-projects (except excluded ones), all time
export const projectUsageTotals = (exclude: Set<string> = new Set()) => {
  const usage = new Map(byProject({ since: null, projectIds: null }).map((u) => [u.projectId, u]))
  return (id: string) =>
    projectWithDescendants(id)
      .filter((pid) => !exclude.has(pid))
      .reduce(
        (acc, pid) => {
          const u = usage.get(pid)
          return u ? { sessions: acc.sessions + u.sessions, cost: acc.cost + u.costUsd } : acc
        },
        { sessions: 0, cost: 0 },
      )
}

export const setProjectHidden = (id: string, hidden: boolean) => {
  db()
    .prepare('UPDATE projects SET hidden = ? WHERE id = ?')
    .run(hidden ? 1 : 0, id)
}

// Where agents of a project work: its own folder, or for an umbrella project without one, the
// folder of its nearest sub-project (the shallowest, then by name)
export const projectWorkPath = (projectId: string): string | null => {
  const projects = listProjects()
  let level = projects.filter((p) => p.id === projectId)
  while (level.length) {
    const withPath = level.find((p) => p.path)
    if (withPath?.path) return withPath.path
    const ids = new Set(level.map((p) => p.id))
    level = projects.filter((p) => p.parentId !== null && ids.has(p.parentId))
  }
  return null
}

// Folders an agent of the project may read without asking: the project's own folder and those of
// its parents (for a sub-project: the whole workspace with its sibling repos and specs)
export const projectReadRoots = (projectId: string): string[] => {
  const projects = listProjects()
  const roots: string[] = []
  let current = projects.find((p) => p.id === projectId)
  while (current) {
    if (current.path) roots.push(current.path)
    const parentId = current.parentId
    current = parentId ? projects.find((p) => p.id === parentId) : undefined
  }
  return roots
}

// Which projects each team serves, by name: only the top-most of the projects it is attached to,
// so teams of a project and its subprojects group under the project
export const teamProjectNames = () => {
  const parents = new Map<string, string | null>()
  const names = new Map<string, string>()
  for (const row of db().prepare('SELECT id, parent_id, name FROM projects').all()) {
    const r = obj(row)
    const id = str(r?.['id'])
    if (!id) continue
    parents.set(id, str(r?.['parent_id']) ?? null)
    names.set(id, str(r?.['name']) ?? id)
  }
  const attached = new Map<string, Set<string>>()
  for (const row of db().prepare('SELECT team_id, project_id FROM project_teams').all()) {
    const r = obj(row)
    const teamId = str(r?.['team_id'])
    const projectId = str(r?.['project_id'])
    if (teamId && projectId)
      attached.set(teamId, (attached.get(teamId) ?? new Set()).add(projectId))
  }
  const hasAttachedAncestor = (projectId: string, set: Set<string>) => {
    for (let p = parents.get(projectId) ?? null; p; p = parents.get(p) ?? null)
      if (set.has(p)) return true
    return false
  }
  const result = new Map<string, string[]>()
  for (const [teamId, set] of attached) {
    result.set(
      teamId,
      [...set]
        .filter((id) => !hasAttachedAncestor(id, set))
        .map((id) => names.get(id) ?? id)
        .sort(),
    )
  }
  return result
}
