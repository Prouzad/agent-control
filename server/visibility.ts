import { cookies } from 'next/headers'

import { listAccounts, type Account } from './accounts'
import { db } from './db'
import { listTeams, type Role, type Team } from './org'
import { listPipelines, type Pipeline } from './pipelines'
import { listProjects, projectOptions, type Project } from './projects'
import { listTasks, type Task } from './tasks'
import { obj, str } from '@/lib/json'

export const WORKSPACE_COOKIE = 'ac-workspace'

// What the dashboard may show right now: hidden projects never appear, and when a workspace is
// picked only that project and its sub-projects do
export type View = {
  workspaceId: string | null
  hidden: Set<string>
  // Visible project ids; null means every project that is not hidden
  allowed: Set<string> | null
  allowsProject: (projectId: string | null) => boolean
  // For sessions and events: their project if known, else the folder they ran in
  allowsSession: (projectId: string | null, cwd: string | null) => boolean
}

const under = (cwd: string, root: string) => cwd === root || cwd.startsWith(`${root}/`)

const descendants = (projects: Project[], id: string): string[] => [
  id,
  ...projects.filter((p) => p.parentId === id).flatMap((p) => descendants(projects, p.id)),
]

export const computeView = (workspaceId: string | null): View => {
  const projects = listProjects()
  const hidden = new Set(
    projects.filter((p) => p.hidden).flatMap((p) => descendants(projects, p.id)),
  )
  const workspace =
    workspaceId && projects.some((p) => p.id === workspaceId) && !hidden.has(workspaceId)
      ? workspaceId
      : null
  const allowed = workspace ? new Set(descendants(projects, workspace)) : null
  const pathsOf = (ids: Set<string>) =>
    projects.flatMap((p) => (ids.has(p.id) && p.path ? [p.path] : []))
  const hiddenPaths = pathsOf(hidden)
  const allowedPaths = allowed ? pathsOf(allowed) : []

  const allowsProject = (projectId: string | null) => {
    if (projectId && hidden.has(projectId)) return false
    if (!allowed) return true
    return projectId !== null && allowed.has(projectId)
  }
  const allowsSession = (projectId: string | null, cwd: string | null) => {
    if (projectId) return allowsProject(projectId)
    if (cwd && hiddenPaths.some((root) => under(cwd, root))) return false
    if (!allowed) return true
    return cwd !== null && allowedPaths.some((root) => under(cwd, root))
  }
  return { workspaceId: workspace, hidden, allowed, allowsProject, allowsSession }
}

export const readView = async (): Promise<View> => {
  const store = await cookies()
  return computeView(store.get(WORKSPACE_COOKIE)?.value ?? null)
}

// A team bound to projects is visible only while one of them is
export const visibleTeams = (view: View, teams: Team[] = listTeams()): Team[] => {
  const bindings = new Map<string, string[]>()
  for (const row of db().prepare('SELECT project_id, team_id FROM project_teams').all()) {
    const r = obj(row)
    const teamId = str(r?.['team_id'])
    const projectId = str(r?.['project_id'])
    if (teamId && projectId) bindings.set(teamId, [...(bindings.get(teamId) ?? []), projectId])
  }
  return teams.filter((team) => {
    const bound = bindings.get(team.id)
    return !bound || bound.some((id) => view.allowsProject(id))
  })
}

export const visibleRoles = (view: View): Role[] => visibleTeams(view).flatMap((t) => t.roles)

// An account that only hidden projects use is hidden with them; the default one always shows
export const visibleAccounts = (view: View, accounts: Account[] = listAccounts()): Account[] => {
  const projects = listProjects()
  return accounts.filter((account) => {
    if (account.id === 'default') return true
    const users = projects.filter((p) => p.accountId === account.id)
    return !users.length || users.some((p) => view.allowsProject(p.id))
  })
}

export const visibleProjectOptions = (view: View) =>
  projectOptions().filter((option) => view.allowsProject(option.id))

export const visibleTasks = (view: View): Task[] =>
  listTasks().filter((task) => view.allowsProject(task.projectId))

export const visiblePipelines = (view: View): Pipeline[] =>
  listPipelines().filter((pipeline) => view.allowsProject(pipeline.projectId))
