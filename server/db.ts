import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { seedOrg } from './seed/org'

export const DATA_DIR =
  process.env['AGENT_CONTROL_DATA'] ?? path.join(os.homedir(), '.agent-control')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'api_key')),
  config_dir TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS index_files (
  path TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  offset INTEGER NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  cwd TEXT,
  title TEXT,
  first_prompt TEXT,
  version TEXT,
  git_branch TEXT,
  started_at TEXT,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_id);

CREATE TABLE IF NOT EXISTS subagents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_type TEXT,
  description TEXT,
  started_at TEXT
);
CREATE INDEX IF NOT EXISTS subagents_session ON subagents(session_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  ts TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_5m_tokens INTEGER NOT NULL,
  cache_write_1h_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS messages_ts ON messages(ts);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  ts TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT,
  is_error INTEGER
);
CREATE INDEX IF NOT EXISTS tool_calls_session ON tool_calls(session_id, ts);
CREATE INDEX IF NOT EXISTS tool_calls_ts ON tool_calls(ts);
`

// Ordered migrations on top of SCHEMA; PRAGMA user_version counts the applied ones
const MIGRATIONS = [
  `
  ALTER TABLE tool_calls ADD COLUMN target_path TEXT;
  CREATE TABLE IF NOT EXISTS session_projects (
    session_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    touches INTEGER NOT NULL,
    PRIMARY KEY (session_id, project_id)
  );
  CREATE TABLE IF NOT EXISTS hook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event TEXT NOT NULL,
    cwd TEXT,
    agent_id TEXT,
    agent_type TEXT,
    tool_name TEXT,
    tool_use_id TEXT,
    summary TEXT
  );
  CREATE INDEX IF NOT EXISTS hook_events_session ON hook_events(session_id, id);
  CREATE INDEX IF NOT EXISTS hook_events_ts ON hook_events(ts);
  -- Re-read every transcript so existing tool calls get target_path
  DELETE FROM index_files;
  `,
  `
  CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE roles (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'inherit',
    tools TEXT NOT NULL DEFAULT '[]',
    skills TEXT NOT NULL DEFAULT '[]',
    is_lead INTEGER NOT NULL DEFAULT 0,
    prompt TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX roles_team ON roles(team_id, sort);
  CREATE TABLE org_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 1,
    isolation TEXT NOT NULL DEFAULT 'worktree',
    permission_mode TEXT NOT NULL DEFAULT 'default',
    budget_usd REAL,
    session_id TEXT,
    worktree_path TEXT,
    branch TEXT,
    base_commit TEXT,
    cwd TEXT,
    result TEXT,
    error TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    num_turns INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX tasks_status ON tasks(status, priority, created_at);
  CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT,
    tool_name TEXT,
    is_error INTEGER
  );
  CREATE INDEX task_events_task ON task_events(task_id, id);
  CREATE TABLE permission_requests (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    title TEXT,
    input TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_at TEXT
  );
  CREATE INDEX permission_requests_task ON permission_requests(task_id, status);
  `,
  // Roles that work with Figma or a browser get the MCP servers
  `
  UPDATE roles SET tools = json_insert(tools, '$[#]', 'MCP')
  WHERE id IN ('ui-designer', 'ui-engineer', 'frontend-a11y-performance', 'manual-tester', 'accessibility-tester')
    AND NOT EXISTS (SELECT 1 FROM json_each(roles.tools) WHERE value = 'MCP');
  `,
  `
  CREATE TABLE pipelines (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    template TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'default',
    stage_budget_usd REAL,
    worktree_path TEXT,
    branch TEXT,
    base_commit TEXT,
    cwd TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE pipeline_stages (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    stage_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('agent', 'gate')),
    label TEXT NOT NULL,
    role_id TEXT,
    task_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    output TEXT,
    verdict TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX pipeline_stages_pipeline ON pipeline_stages(pipeline_id, idx);
  ALTER TABLE tasks ADD COLUMN pipeline_id TEXT;
  ALTER TABLE tasks ADD COLUMN stage_id TEXT;
  `,
  // Project teams: a project works with chosen teams, their roles cover pipeline stages,
  // and a delegating team's lead can call its members as subagents
  `
  CREATE TABLE project_teams (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, team_id)
  );
  ALTER TABLE roles ADD COLUMN stages TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE teams ADD COLUMN delegate INTEGER NOT NULL DEFAULT 0;
  `,
  // A hidden project and everything tied to it disappears from every view
  `
  ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  `,
  // CTO dispatch: a routed task hands parts to team leads as ordered sub-tasks
  `
  ALTER TABLE tasks ADD COLUMN parent_id TEXT;
  ALTER TABLE tasks ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN dispatch TEXT;
  `,
  // Auto-mode gates: the roles that approved the gate in the current round
  `
  ALTER TABLE pipeline_stages ADD COLUMN approvals TEXT NOT NULL DEFAULT '[]';
  `,
  // A model picked for this task over its role's model
  `
  ALTER TABLE tasks ADD COLUMN model TEXT;
  `,
  // What the person told a pipeline while it ran; every later stage reads it
  `
  CREATE TABLE pipeline_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    stage_id TEXT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX pipeline_messages_pipeline ON pipeline_messages(pipeline_id, id);
  `,
  // Approvals by the architect and the development lead: who the decision went up to, and
  // whether the board is deciding on a check stage that ran out of rework rounds
  `
  ALTER TABLE pipeline_stages ADD COLUMN escalation TEXT;
  ALTER TABLE pipeline_stages ADD COLUMN deciding INTEGER NOT NULL DEFAULT 0;
  `,
  // Lessons agents learned from past mistakes, per project and optionally per role
  `
  CREATE TABLE lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role_id TEXT,
    text TEXT NOT NULL,
    source TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX lessons_project ON lessons(project_id, archived);
  ALTER TABLE pipelines ADD COLUMN lessons_at TEXT;
  `,
  // The pipeline report: a model's summary of the stage reports, kept until refreshed
  `
  ALTER TABLE pipelines ADD COLUMN report TEXT;
  ALTER TABLE pipelines ADD COLUMN report_at TEXT;
  `,
  // Whether the report summary is rebuilt after every stage
  `
  ALTER TABLE pipelines ADD COLUMN report_auto INTEGER NOT NULL DEFAULT 1;
  `,
  // Archive: finished pipelines go here and are deleted two weeks later
  `
  ALTER TABLE pipelines ADD COLUMN archived_at TEXT;
  UPDATE pipelines SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'done';
  `,
]

const migrate = (db: Database.Database) => {
  const version = Number(db.pragma('user_version', { simple: true }))
  MIGRATIONS.slice(version).forEach((sql, index) => {
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${version + index + 1}`)
    })()
  })
}

const open = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(path.join(DATA_DIR, 'agent-control.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  seedOrg(db)
  const hasAccounts = db.prepare('SELECT 1 FROM accounts LIMIT 1').get()
  if (!hasAccounts) {
    db.prepare(
      'INSERT INTO accounts (id, name, kind, config_dir, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('default', 'Основная подписка', 'subscription', path.join(os.homedir(), '.claude'), now())
  }
  return db
}

export const now = () => new Date().toISOString()

declare global {
  var agentControlDb: Database.Database | undefined
}

// One connection per server process; survives dev hot reloads
export const db = (): Database.Database => {
  globalThis.agentControlDb ??= open()
  return globalThis.agentControlDb
}
