import { randomUUID } from 'node:crypto'

import { arr, obj, str } from '@/lib/json'
import { MCP_TOOL } from '@/lib/roles'

import { db, now } from './db'
import { DEFAULT_COMMON_RULES } from './seed/org'

export type Role = {
  id: string
  teamId: string
  title: string
  description: string
  model: string
  tools: string[]
  skills: string[]
  isLead: boolean
  prompt: string
  // Pipeline stage keys this role takes over in projects that work with its team
  stages: string[]
  sort: number
  updatedAt: string
}

export type Team = {
  id: string
  name: string
  description: string
  // The lead may hand parts of a task to the team's other roles as subagents
  delegate: boolean
  sort: number
  roles: Role[]
}

const parseList = (value: unknown) => {
  try {
    return arr(JSON.parse(str(value) ?? '[]')).flatMap((v) => str(v) ?? [])
  } catch {
    return []
  }
}

const toRole = (row: unknown): Role | undefined => {
  const r = obj(row)
  const id = str(r?.['id'])
  const teamId = str(r?.['team_id'])
  if (!r || !id || !teamId) return undefined
  return {
    id,
    teamId,
    title: str(r['title']) ?? id,
    description: str(r['description']) ?? '',
    model: str(r['model']) ?? 'inherit',
    tools: parseList(r['tools']),
    skills: parseList(r['skills']),
    isLead: r['is_lead'] === 1,
    prompt: str(r['prompt']) ?? '',
    stages: parseList(r['stages']),
    sort: Number(r['sort'] ?? 0),
    updatedAt: str(r['updated_at']) ?? '',
  }
}

// Leads first, then the configured order
export const listRoles = (): Role[] =>
  db()
    .prepare('SELECT * FROM roles ORDER BY is_lead DESC, sort, title')
    .all()
    .flatMap((row) => toRole(row) ?? [])

export const getRole = (id: string) =>
  toRole(db().prepare('SELECT * FROM roles WHERE id = ?').get(id))

export const listTeams = (): Team[] => {
  const roles = listRoles()
  return db()
    .prepare('SELECT * FROM teams ORDER BY sort, name')
    .all()
    .flatMap((row) => {
      const r = obj(row)
      const id = str(r?.['id'])
      const name = str(r?.['name'])
      if (!id || !name) return []
      return [
        {
          id,
          name,
          description: str(r?.['description']) ?? '',
          delegate: r?.['delegate'] === 1,
          sort: Number(r?.['sort'] ?? 0),
          roles: roles.filter((role) => role.teamId === id),
        },
      ]
    })
}

export const getTeam = (id: string) => listTeams().find((t) => t.id === id)

export const ROLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type RoleInput = {
  id: string
  teamId: string
  title: string
  description: string
  model: string
  tools: string[]
  skills: string[]
  isLead: boolean
  prompt: string
  stages: string[]
}

const roleParams = (input: RoleInput) => ({
  id: input.id,
  teamId: input.teamId,
  title: input.title.trim(),
  description: input.description.trim(),
  model: input.model,
  tools: JSON.stringify(input.tools),
  skills: JSON.stringify(input.skills),
  isLead: input.isLead ? 1 : 0,
  prompt: input.prompt.trim(),
  stages: JSON.stringify(input.stages),
  now: now(),
})

// A team has at most one lead: promoting a role demotes the previous one
const demoteOtherLeads = (teamId: string, roleId: string) =>
  db().prepare('UPDATE roles SET is_lead = 0 WHERE team_id = ? AND id != ?').run(teamId, roleId)

export const createRole = (input: RoleInput) => {
  if (!ROLE_ID_PATTERN.test(input.id)) throw new Error('Системное имя: латиница, цифры и дефисы')
  if (getRole(input.id)) throw new Error(`Роль «${input.id}» уже есть`)
  const sort = Number(
    obj(
      db()
        .prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM roles WHERE team_id = ?')
        .get(input.teamId),
    )?.['next'] ?? 0,
  )
  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO roles (id, team_id, title, description, model, tools, skills, is_lead, prompt, stages, sort, created_at, updated_at)
         VALUES (@id, @teamId, @title, @description, @model, @tools, @skills, @isLead, @prompt, @stages, @sort, @now, @now)`,
      )
      .run({ ...roleParams(input), sort })
    if (input.isLead) demoteOtherLeads(input.teamId, input.id)
  })()
}

export const updateRole = (id: string, input: Omit<RoleInput, 'id'>) => {
  db().transaction(() => {
    db()
      .prepare(
        `UPDATE roles SET team_id = @teamId, title = @title, description = @description, model = @model,
           tools = @tools, skills = @skills, is_lead = @isLead, prompt = @prompt, stages = @stages,
           updated_at = @now
         WHERE id = @id`,
      )
      .run(roleParams({ ...input, id }))
    if (input.isLead) demoteOtherLeads(input.teamId, id)
  })()
}

export const deleteRole = (id: string) => {
  db().prepare('DELETE FROM roles WHERE id = ?').run(id)
}

type TeamInput = { name: string; description: string; delegate: boolean }

export const createTeam = (input: TeamInput) => {
  const sort = Number(
    obj(db().prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM teams').get())?.['next'] ?? 0,
  )
  const id = randomUUID().slice(0, 8)
  db()
    .prepare(
      'INSERT INTO teams (id, name, description, delegate, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, input.name.trim(), input.description.trim(), input.delegate ? 1 : 0, sort, now())
  return id
}

export const updateTeam = (id: string, input: TeamInput) => {
  db()
    .prepare('UPDATE teams SET name = ?, description = ?, delegate = ? WHERE id = ?')
    .run(input.name.trim(), input.description.trim(), input.delegate ? 1 : 0, id)
}

export const deleteTeam = (id: string) => {
  if (db().prepare('SELECT 1 FROM roles WHERE team_id = ? LIMIT 1').get(id)) {
    throw new Error('Сначала перенесите или удалите роли команды')
  }
  db().prepare('DELETE FROM teams WHERE id = ?').run(id)
}

export const getCommonRules = () =>
  str(
    obj(db().prepare("SELECT value FROM org_settings WHERE key = 'common_rules'").get())?.['value'],
  ) ?? DEFAULT_COMMON_RULES

export const setCommonRules = (value: string) => {
  db()
    .prepare(
      "INSERT INTO org_settings (key, value) VALUES ('common_rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(value.trim())
}

// The role as a Claude Code subagent file (.claude/agents/<id>.md)
export const roleMarkdown = (role: Role, teamName: string, commonRules: string) => {
  const builtinTools = role.tools.filter((t) => t !== MCP_TOOL)
  const frontmatter = [
    '---',
    `name: ${role.id}`,
    `description: ${JSON.stringify(`${role.title} (${teamName}). ${role.description}`)}`,
    builtinTools.length ? `tools: ${builtinTools.join(', ')}` : null,
    role.tools.includes(MCP_TOOL)
      ? '# MCP: add the MCP tools this role needs by name, e.g. mcp__chrome-devtools__take_screenshot'
      : null,
    `model: ${role.model}`,
    '---',
  ].filter((line) => line !== null)
  const skills = role.skills.length
    ? `\n\n## Скиллы\nЕсли в проекте есть скиллы ${role.skills.map((s) => `/${s}`).join(', ')} — используй их для своей работы.`
    : ''
  return `${frontmatter.join('\n')}\n\n${role.prompt}${skills}\n\n## Общие правила\n${commonRules}\n`
}

export type BuiltinAgentUsage = { agentType: string; runs: number }

// Subagent types Claude Code actually spawned in indexed sessions
export const builtinAgentUsage = (): BuiltinAgentUsage[] =>
  db()
    .prepare(
      `SELECT COALESCE(agent_type, 'unknown') AS agent_type, COUNT(*) AS runs
       FROM subagents GROUP BY agent_type ORDER BY runs DESC`,
    )
    .all()
    .flatMap((row) => {
      const r = obj(row)
      const agentType = str(r?.['agent_type'])
      return agentType ? [{ agentType, runs: Number(r?.['runs'] ?? 0) }] : []
    })
