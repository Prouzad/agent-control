import fs from 'node:fs'
import path from 'node:path'

import { arr, num, obj, parseJson, str, type Json } from '@/lib/json'
import { targetPath } from '@/lib/paths'

import { bus } from './bus'
import { db } from './db'
import { costUsd } from './pricing'
import { assignSessionProjects } from './projects'

const CHUNK_BYTES = 4 * 1024 * 1024
const LOOP_MS = 15_000
// Cheap pre-filter: only these record types carry data we index
const WANTED = ['"type":"assistant"', '"type":"user"', '"type":"ai-title"']

type TranscriptFile = {
  path: string
  accountId: string
  sessionId: string
  agentId: string | null
}

type SessionPatch = {
  cwd?: string
  title?: string
  firstPrompt?: string
  version?: string
  gitBranch?: string
  startedAt?: string
  endedAt?: string
}

const listDir = (dir: string) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

const discover = (accountId: string, configDir: string): TranscriptFile[] => {
  const files: TranscriptFile[] = []
  const root = path.join(configDir, 'projects')
  for (const projectDir of listDir(root)) {
    if (!projectDir.isDirectory()) continue
    const dir = path.join(root, projectDir.name)
    for (const entry of listDir(dir)) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const sessionId = entry.name.slice(0, -'.jsonl'.length)
        files.push({ path: path.join(dir, entry.name), accountId, sessionId, agentId: null })
      }
      if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name, 'subagents')
        for (const sub of listDir(subDir)) {
          const match = /^agent-(.+)\.jsonl$/.exec(sub.name)
          if (!match?.[1]) continue
          files.push({
            path: path.join(subDir, sub.name),
            accountId,
            sessionId: entry.name,
            agentId: match[1],
          })
        }
      }
    }
  }
  return files
}

const promptText = (content: unknown): string | undefined => {
  const text =
    str(content) ??
    arr(content)
      .map(obj)
      .find((block) => block?.['type'] === 'text')?.['text']
  const value = str(text)?.trim()
  // Slash-command wrappers and system reminders are not what the human typed
  if (!value || value.startsWith('<')) return undefined
  return value.slice(0, 500)
}

const toolSummary = (input: Json | undefined) => {
  if (!input) return null
  const keys = ['description', 'command', 'file_path', 'pattern', 'url', 'query', 'prompt', 'skill']
  for (const key of keys) {
    const value = str(input[key])
    if (value) return value.replace(/\s+/g, ' ').slice(0, 200)
  }
  return null
}

const statements = () => {
  const d = db()
  return {
    upsertSession: d.prepare(`
      INSERT INTO sessions (id, account_id, cwd, title, first_prompt, version, git_branch, started_at, ended_at)
      VALUES (@id, @accountId, @cwd, @title, @firstPrompt, @version, @gitBranch, @startedAt, @endedAt)
      ON CONFLICT(id) DO UPDATE SET
        cwd = COALESCE(sessions.cwd, excluded.cwd),
        title = COALESCE(excluded.title, sessions.title),
        first_prompt = COALESCE(sessions.first_prompt, excluded.first_prompt),
        version = COALESCE(excluded.version, sessions.version),
        git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
        started_at = MIN(COALESCE(sessions.started_at, excluded.started_at), COALESCE(excluded.started_at, sessions.started_at)),
        ended_at = MAX(COALESCE(sessions.ended_at, excluded.ended_at), COALESCE(excluded.ended_at, sessions.ended_at))
    `),
    upsertMessage: d.prepare(`
      INSERT INTO messages (id, session_id, agent_id, ts, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cost_usd)
      VALUES (@id, @sessionId, @agentId, @ts, @model, @input, @output, @cacheRead, @cacheWrite5m, @cacheWrite1h, @cost)
      ON CONFLICT(id) DO UPDATE SET
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens, cache_write_5m_tokens = excluded.cache_write_5m_tokens,
        cache_write_1h_tokens = excluded.cache_write_1h_tokens, cost_usd = excluded.cost_usd
    `),
    insertTool: d.prepare(`
      INSERT INTO tool_calls (id, session_id, agent_id, ts, name, summary, target_path)
      VALUES (@id, @sessionId, @agentId, @ts, @name, @summary, @targetPath)
      ON CONFLICT(id) DO UPDATE SET target_path = excluded.target_path
    `),
    toolResult: d.prepare('UPDATE tool_calls SET is_error = ? WHERE id = ?'),
    upsertSubagent: d.prepare(`
      INSERT INTO subagents (id, session_id, agent_type, description, started_at)
      VALUES (@id, @sessionId, @agentType, @description, @startedAt)
      ON CONFLICT(id) DO UPDATE SET
        agent_type = COALESCE(excluded.agent_type, subagents.agent_type),
        description = COALESCE(excluded.description, subagents.description),
        started_at = COALESCE(subagents.started_at, excluded.started_at)
    `),
    getOffset: d.prepare('SELECT offset, size FROM index_files WHERE path = ?'),
    setOffset: d.prepare(`
      INSERT INTO index_files (path, account_id, offset, size, mtime_ms) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, size = excluded.size, mtime_ms = excluded.mtime_ms
    `),
  }
}

type Statements = ReturnType<typeof statements>

const applyRecord = (s: Statements, file: TranscriptFile, record: Json, patch: SessionPatch) => {
  const type = record['type']
  if (type === 'ai-title' && !file.agentId) {
    patch.title = str(record['aiTitle']) ?? patch.title
    return
  }
  if (type !== 'user' && type !== 'assistant') return

  const ts = str(record['timestamp'])
  if (ts) {
    if (!patch.startedAt || ts < patch.startedAt) patch.startedAt = ts
    if (!patch.endedAt || ts > patch.endedAt) patch.endedAt = ts
  }
  if (!file.agentId) {
    patch.cwd ??= str(record['cwd'])
    patch.version = str(record['version']) ?? patch.version
    patch.gitBranch = str(record['gitBranch']) ?? patch.gitBranch
  }

  const message = obj(record['message'])
  if (!message || !ts) return

  if (type === 'user') {
    const content = message['content']
    for (const block of arr(content).map(obj)) {
      if (block?.['type'] !== 'tool_result') continue
      const id = str(block['tool_use_id'])
      if (id) s.toolResult.run(block['is_error'] === true ? 1 : 0, id)
    }
    if (!file.agentId && record['isMeta'] !== true && !record['toolUseResult']) {
      patch.firstPrompt ??= promptText(content)
    }
    return
  }

  const model = str(message['model'])
  const id = str(message['id']) ?? str(record['uuid'])
  const usage = obj(message['usage'])
  if (model && id && usage && !model.startsWith('<')) {
    const cacheCreation = obj(usage['cache_creation'])
    const cacheWriteTotal = num(usage['cache_creation_input_tokens'])
    const cacheWrite1h = num(cacheCreation?.['ephemeral_1h_input_tokens'])
    const counts = {
      input: num(usage['input_tokens']),
      output: num(usage['output_tokens']),
      cacheRead: num(usage['cache_read_input_tokens']),
      cacheWrite1h,
      cacheWrite5m: Math.max(0, cacheWriteTotal - cacheWrite1h),
      fast: usage['speed'] === 'fast',
    }
    s.upsertMessage.run({
      id,
      sessionId: file.sessionId,
      agentId: file.agentId,
      ts,
      model,
      input: counts.input,
      output: counts.output,
      cacheRead: counts.cacheRead,
      cacheWrite5m: counts.cacheWrite5m,
      cacheWrite1h: counts.cacheWrite1h,
      cost: costUsd(model, counts),
    })
  }

  for (const block of arr(message['content']).map(obj)) {
    if (block?.['type'] !== 'tool_use') continue
    const toolId = str(block['id'])
    const name = str(block['name'])
    if (!toolId || !name) continue
    const input = obj(block['input'])
    s.insertTool.run({
      id: toolId,
      sessionId: file.sessionId,
      agentId: file.agentId,
      ts,
      name,
      summary: toolSummary(input),
      targetPath: targetPath(input, str(record['cwd'])),
    })
  }
}

const readSubagentMeta = (s: Statements, file: TranscriptFile, startedAt: string | undefined) => {
  if (!file.agentId) return
  let meta: Json | undefined
  try {
    meta = parseJson(fs.readFileSync(file.path.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
  } catch {
    meta = undefined
  }
  s.upsertSubagent.run({
    id: file.agentId,
    sessionId: file.sessionId,
    agentType: str(meta?.['agentType']) ?? null,
    description: str(meta?.['description']) ?? null,
    startedAt: startedAt ?? null,
  })
}

const indexFile = async (s: Statements, file: TranscriptFile) => {
  const stat = fs.statSync(file.path)
  const saved = obj(s.getOffset.get(file.path))
  let offset = num(saved?.['offset'])
  // File shrank (rewritten): start over; rows are upserts, so re-reading is safe
  if (stat.size < offset) offset = 0
  if (stat.size === offset) return

  const handle = await fs.promises.open(file.path, 'r')
  const chunk = Buffer.alloc(CHUNK_BYTES)
  // Split on the newline byte, not on decoded text: a chunk edge can cut a multi-byte character
  let carry = Buffer.alloc(0)
  try {
    while (offset + carry.length < stat.size) {
      const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, offset + carry.length)
      if (bytesRead === 0) break
      const bytes = Buffer.concat([carry, chunk.subarray(0, bytesRead)])
      const lastNewline = bytes.lastIndexOf(0x0a)
      if (lastNewline === -1) {
        // A single line longer than the chunk: keep accumulating
        carry = bytes
        continue
      }
      const complete = bytes.toString('utf8', 0, lastNewline)
      carry = Buffer.from(bytes.subarray(lastNewline + 1))
      const patch: SessionPatch = {}
      db().transaction(() => {
        for (const line of complete.split('\n')) {
          if (!WANTED.some((marker) => line.includes(marker))) continue
          const record = parseJson(line)
          if (record) applyRecord(s, file, record, patch)
        }
        s.upsertSession.run({
          id: file.sessionId,
          accountId: file.accountId,
          cwd: patch.cwd ?? null,
          title: patch.title ?? null,
          firstPrompt: patch.firstPrompt ?? null,
          version: patch.version ?? null,
          gitBranch: patch.gitBranch ?? null,
          startedAt: patch.startedAt ?? null,
          endedAt: patch.endedAt ?? null,
        })
        readSubagentMeta(s, file, patch.startedAt)
        offset += lastNewline + 1
        s.setOffset.run(file.path, file.accountId, offset, stat.size, Math.round(stat.mtimeMs))
      })()
      // Yield so HTTP requests are served during a long first index
      await new Promise((resolve) => setImmediate(resolve))
    }
  } finally {
    await handle.close()
  }
}

export type IndexResult = { files: number; changed: number; ms: number }

const run = async (): Promise<IndexResult> => {
  const started = Date.now()
  const s = statements()
  const accounts = db()
    .prepare(
      "SELECT id, config_dir FROM accounts WHERE kind = 'subscription' AND config_dir IS NOT NULL",
    )
    .all()
    .map(obj)
  const files = accounts.flatMap((account) => {
    const id = str(account?.['id'])
    const dir = str(account?.['config_dir'])
    return id && dir ? discover(id, dir) : []
  })
  const changedSessions = new Set<string>()
  for (const file of files) {
    const before = num(obj(s.getOffset.get(file.path))?.['offset'])
    try {
      await indexFile(s, file)
    } catch {
      // A transcript being written or removed mid-read is retried on the next pass
      continue
    }
    if (num(obj(s.getOffset.get(file.path))?.['offset']) !== before) {
      changedSessions.add(file.sessionId)
    }
  }
  if (changedSessions.size > 0) assignSessionProjects([...changedSessions])
  return { files: files.length, changed: changedSessions.size, ms: Date.now() - started }
}

declare global {
  var agentControlIndexing: Promise<IndexResult> | undefined
  var agentControlIndexLoop: NodeJS.Timeout | undefined
  var agentControlLastIndex: (IndexResult & { at: string }) | undefined
}

// Concurrent callers share the pass already in flight
export const indexNow = (): Promise<IndexResult> => {
  globalThis.agentControlIndexing ??= run()
    .then((result) => {
      globalThis.agentControlLastIndex = { ...result, at: new Date().toISOString() }
      if (result.changed > 0) bus().emit('index', result)
      return result
    })
    .finally(() => {
      globalThis.agentControlIndexing = undefined
    })
  return globalThis.agentControlIndexing
}

export const lastIndex = () => globalThis.agentControlLastIndex

export const isIndexing = () => globalThis.agentControlIndexing !== undefined

export const startIndexLoop = () => {
  if (globalThis.agentControlIndexLoop) return
  // Attribution rules may have changed since the last run: re-apply them to every session once
  assignSessionProjects()
  void indexNow()
  globalThis.agentControlIndexLoop = setInterval(() => void indexNow(), LOOP_MS)
}
