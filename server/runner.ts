import {
  query,
  type AgentDefinition,
  type McpServerConfig,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import os from 'node:os'
import path from 'node:path'

import { arr, obj, str } from '@/lib/json'
import { MCP_TOOL, MODEL_GUIDE, TOOLS } from '@/lib/roles'

import { listAccounts } from './accounts'
import { imageBlocks } from './attachments'
import { bus } from './bus'
import { lessonsPrompt } from './lessons'
import { boardNames, decideByBoard, personOnlyReason } from './permissionBoard'
import { terminalClaudePath } from './claudeCli'
import { createWorktree, headCommit, linkEnvFiles, pathInWorktree, repoRoot } from './git'
import { readApiKey } from './keychain'
import { getCommonRules, getRole, getTeam, type Role } from './org'
import { effectiveAccountId, getProject, projectReadRoots, projectWorkPath } from './projects'
import { runnerSettings } from './settings'
import { freeMemoryPercent } from './system'
import {
  addEvent,
  createPermissionRequest,
  getPermissionRequest,
  getTask,
  listTasks,
  nextQueuedTask,
  pendingPermissions,
  resolvePermissionRequest,
  setPermissionModeColumn,
  updateTask,
  type Task,
  type TaskPermissionMode,
} from './tasks'

const TICK_MS = 3_000

// A UI-only server (AGENT_CONTROL_UI_ONLY=1) runs no agents: an answer given there would only
// reach the database, while the agent waits for it in the real server's memory
export const UI_ONLY = process.env['AGENT_CONTROL_UI_ONLY'] === '1'
// Agent stderr and message flow in the server log, for when a run will not start
const DEBUG = process.env['AGENT_CONTROL_DEBUG'] === '1'

const assertRunner = () => {
  if (UI_ONLY) {
    throw new Error(
      'Это сервер только для просмотра — управляйте агентами на основном адресе :4400',
    )
  }
}
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.claude')

// Messages for a running agent: the first prompt, then whatever the human sends later
const createInbox = () => {
  const queue: SDKUserMessage[] = []
  let wake: (() => void) | undefined
  let closed = false
  const notify = () => {
    wake?.()
    wake = undefined
  }
  const messages: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: async function* () {
      while (true) {
        const next = queue.shift()
        if (next) {
          yield next
          continue
        }
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
  return {
    messages,
    push: (content: SDKUserMessage['message']['content']) => {
      queue.push({
        type: 'user',
        message: { role: 'user', content },
        parent_tool_use_id: null,
      })
      notify()
    },
    close: () => {
      closed = true
      notify()
    },
  }
}

type Run = {
  taskId: string
  query: Query
  inbox: ReturnType<typeof createInbox>
  permissions: Map<string, (result: PermissionResult) => void>
  stopping: boolean
  // Subagents and shells the agent left running in the background. A turn that ends while
  // they work is not the end of the task: their results wake the agent for another turn
  background: Set<string>
  waitingForBackground: boolean
  nudge: ReturnType<typeof setTimeout> | null
  // The last non-empty answer, since a closing turn may say nothing new
  lastResult: string | null
  announced: boolean
}

// If the background work is over but the agent does not wake on its own, it is asked to
const NUDGE_MS = 90_000
const NUDGE_TEXT =
  'Фоновые агенты закончили. Проверь их результаты, доделай, что осталось, и подведи итог всей работы.'

const clearNudge = (run: Run) => {
  if (run.nudge) clearTimeout(run.nudge)
  run.nudge = null
}

// Extra tools and instructions another engine gives a task's agent (the CTO dispatch tool)
export type TaskExtras = {
  mcpServers: Record<string, McpServerConfig>
  allowedTools: string[]
  append: string
}

type RunnerState = {
  runs: Map<string, Run>
  followUps: Map<string, string>
  ticking: boolean
  timer?: NodeJS.Timeout
  heldBack: string | null
  extras?: (task: Task) => TaskExtras | null
}

declare global {
  var agentControlRunner: RunnerState | undefined
}

const state = (): RunnerState => {
  globalThis.agentControlRunner ??= {
    runs: new Map(),
    followUps: new Map(),
    ticking: false,
    heldBack: null,
  }
  return globalThis.agentControlRunner
}

export const setTaskExtras = (provide: (task: Task) => TaskExtras | null) => {
  state().extras = provide
}

// How every agent ends its work: a short part a person reads at a glance, then the full analysis
// that later stages and reviewers rely on
const REPORT_FORMAT = [
  '# Как оформить итог',
  'Последнее сообщение — отчёт из двух частей с ровно такими заголовками:',
  '## Коротко',
  '3–5 пунктов простым языком, без кода и путей: что сделано или найдено, что мешает, что нужно от человека.',
  '## Подробно',
  'Полный разбор: детали, файлы, таблицы, решения. Его читают следующие этапы, поэтому здесь ничего не сокращай.',
  'Если в задаче требуется особая последняя строка (например, вердикт), поставь её в самом конце, после «Подробно».',
].join('\n')

// The machine is shared by several agents and the person: heavy checks cost gigabytes of RAM
const RESOURCE_RULES = [
  '# Ресурсы машины',
  'Машину делят несколько агентов и человек, тяжёлые проверки едят гигабайты памяти. Качество проверок не снижай, но не делай лишнего:',
  '- пока правишь код, проверяй только затронутое: ESLint по изменённым файлам с `--cache`, тесты по правке (`jest --findRelatedTests <файлы>` или путь к тест-файлу), `tsc --noEmit` — по необходимости;',
  '- полный `npm run validate` (или его аналог) — один раз перед коммитом; повторяй его, только если после него менял код;',
  '- не запускай тяжёлые проверки параллельно — ни сам, ни участниками команды: одна за раз. Перед запуском проверь, не идёт ли уже такая же в этой папке (`ps`), и дождись её;',
  '- Jest — с `--maxWorkers=50%`, если проект не задаёт своё;',
  '- dev-сервер ветки — один на рабочую папку. Перед запуском проверь, не поднят ли он уже (`lsof -iTCP -sTCP:LISTEN` и рабочая папка процесса) — если да, используй его. Поднятый тобой сервер, вкладки и браузеры закрой, когда закончил, если задание этапа не велит оставить их следующему этапу.',
].join('\n')

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
// Paths an agent never reads on its own, even in auto mode
const ENV_FILE = /(^|\/)\.env(\.|$|\/)/
const SECRET_PATHS = [
  /\/\.ssh(\/|$)/,
  /\/\.aws(\/|$)/,
  /\/\.gnupg(\/|$)/,
  /\.npmrc$/,
  /\.netrc$/,
  /\/\.[\w-]+-token$/,
  /(^|\/)\.?credentials(\.json)?$/i,
  /\/\.config\/gh(\/|$)/,
  /\/\.docker\/config\.json$/,
  /\.(pem|key|p12|pfx)$/,
  /\/Keychains(\/|$)/,
]
// .env files count as secrets unless the settings let agents read them
const touchesSecret = (input: unknown, envReadable: boolean) =>
  Object.values(obj(input) ?? {}).some(
    (value) =>
      typeof value === 'string' &&
      [...SECRET_PATHS, ...(envReadable ? [] : [ENV_FILE])].some((pattern) => pattern.test(value)),
  )

const toolSummary = (input: unknown) => {
  const i = obj(input)
  const value =
    str(i?.['description']) ??
    str(i?.['command']) ??
    str(i?.['file_path']) ??
    str(i?.['pattern']) ??
    str(i?.['url']) ??
    str(i?.['prompt'])
  return value ? value.replace(/\s+/g, ' ').slice(0, 300) : null
}

// Values inherited from the dashboard's own process must not leak into the agent:
// a stray CLAUDECODE marks a nested session, and a stray API key would shadow the account login
const baseEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key !== 'CLAUDECODE' &&
        !key.startsWith('CLAUDE_CODE_') &&
        !['CLAUDE_PID', 'CLAUDE_JOB_DIR', 'CLAUDE_EFFORT', 'ANTHROPIC_API_KEY'].includes(key),
    ),
  )

export const accountEnv = async (
  projectId: string,
): Promise<Record<string, string | undefined>> => {
  const account = listAccounts().find((a) => a.id === effectiveAccountId(projectId))
  if (!account) throw new Error('Аккаунт проекта не найден')
  if (account.kind === 'api_key') {
    const key = await readApiKey(account.id)
    if (!key) throw new Error(`У аккаунта «${account.name}» нет API-ключа в Связке ключей`)
    return { ...baseEnv(), ANTHROPIC_API_KEY: key }
  }
  // The standard login lives at ~/.claude.json; naming ~/.claude explicitly makes Claude Code look for
  // ~/.claude/.claude.json instead and report "Not logged in", so only other folders are passed on
  const dir = account.configDir
  if (!dir || path.resolve(dir) === DEFAULT_CONFIG_DIR) return baseEnv()
  return { ...baseEnv(), CLAUDE_CONFIG_DIR: dir }
}

const BUILTIN_TOOLS: string[] = TOOLS.flatMap((t) => (t.name === MCP_TOOL ? [] : [t.name]))

// A team member as a subagent of its lead. Members with MCP inherit the session's tools minus
// the built-in ones they were not granted, since MCP tool names are not known up front
const subagent = (member: Role, commonRules: string, parity: boolean): AgentDefinition => {
  const builtin = member.tools.filter((t) => t !== MCP_TOOL)
  return {
    description: `${member.title}. ${member.description}`,
    prompt: `# Твоя роль: ${member.title}\n\n${member.prompt}\n\n# Общие правила\n\n${commonRules}`,
    ...(member.model !== 'inherit' ? { model: member.model } : {}),
    // Like a terminal session, a member inherits every tool of the session
    ...(parity
      ? {}
      : member.tools.includes(MCP_TOOL)
        ? { disallowedTools: [...BUILTIN_TOOLS.filter((t) => !builtin.includes(t)), 'Agent'] }
        : { tools: builtin }),
  }
}

const teamBrief = (members: Role[]) =>
  [
    '# Твоя команда',
    'Ты лид. Части задачи можешь поручить участникам команды через инструмент Agent (subagent_type — id роли).',
    'Зови только тех, кто нужен именно этой задаче: каждый прогон стоит денег и времени. Мелочь делай сам.',
    'Ставь участнику конкретную задачу с входными данными и критерием готовности, результат проверяй.',
    'Поручив работу участникам, дождись их итогов и проверь их. Задача закрывается твоим последним ответом, поэтому в нём должен быть итог всей работы, а не «жду».',
    'У вызова Agent есть параметр model: если план указал модель для шага — передай её; иначе выбери сам.',
    MODEL_GUIDE,
    '',
    ...members.map((m) => `- ${m.id} — ${m.title}: ${m.description}`),
  ].join('\n')

const initialPrompt = (task: Task) =>
  task.description ? `# ${task.title}\n\n${task.description}` : task.title

const fail = (taskId: string, message: string) => {
  updateTask(taskId, { status: 'failed', error: message, finishedAt: new Date().toISOString() })
  addEvent(taskId, 'error', message)
  // Setup failures never reach the run loop, so pipelines must hear about them here too
  bus().emit('task-finished', { taskId })
}

const handleMessage = (run: Run, message: SDKMessage) => {
  const taskId = run.taskId
  if (message.type === 'system' && message.subtype === 'init') {
    updateTask(taskId, { sessionId: message.session_id })
    // Every turn starts with init; only the first one is news
    if (!run.announced) {
      run.announced = true
      addEvent(
        taskId,
        'status',
        `Агент запущен: ${message.model}, ${message.tools.length} инструментов`,
      )
    }
    return
  }
  if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
    run.background = new Set(message.tasks.filter((t) => !t.ambient).map((t) => t.task_id))
    if (run.waitingForBackground && run.background.size === 0 && !run.nudge) {
      run.nudge = setTimeout(() => {
        run.nudge = null
        if (!run.waitingForBackground) return
        run.waitingForBackground = false
        addEvent(taskId, 'prompt', NUDGE_TEXT)
        run.inbox.push(NUDGE_TEXT)
      }, NUDGE_MS)
    }
    return
  }
  // Anything the agent says after a waiting turn means it woke up
  if (message.type === 'assistant' && run.waitingForBackground) {
    run.waitingForBackground = false
    clearNudge(run)
  }
  // Subagent traffic (parent_tool_use_id set) stays out of the task log
  if (message.type === 'assistant' && message.parent_tool_use_id === null) {
    for (const block of arr(message.message.content).map(obj)) {
      if (block?.['type'] === 'text') {
        const text = str(block['text'])?.trim()
        if (text) addEvent(taskId, 'assistant', text)
      }
      if (block?.['type'] === 'tool_use') {
        const name = str(block['name']) ?? 'tool'
        addEvent(taskId, 'tool', toolSummary(block['input']), { toolName: name })
      }
    }
    return
  }
  if (message.type === 'user' && message.parent_tool_use_id === null) {
    for (const block of arr(message.message.content).map(obj)) {
      if (block?.['type'] === 'tool_result' && block['is_error'] === true) {
        const content = block['content']
        const text =
          str(content) ??
          arr(content)
            .map((c) => str(obj(c)?.['text']) ?? '')
            .join('\n')
        addEvent(taskId, 'tool_error', text.slice(0, 2_000), { isError: true })
      }
    }
    return
  }
  if (message.type === 'result') {
    const previous = getTask(taskId)
    const success = message.subtype === 'success' && !message.is_error
    const usage = {
      costUsd: (previous?.costUsd ?? 0) + message.total_cost_usd,
      numTurns: (previous?.numTurns ?? 0) + message.num_turns,
    }
    if (message.subtype === 'success' && message.result.trim()) run.lastResult = message.result
    if (success && run.background.size > 0) {
      updateTask(taskId, usage)
      run.waitingForBackground = true
      addEvent(
        taskId,
        'status',
        `Ход окончен, агент ждёт фоновую работу: ${run.background.size} в процессе`,
      )
      return
    }
    run.waitingForBackground = false
    clearNudge(run)
    updateTask(taskId, {
      status: success ? 'review' : 'failed',
      ...usage,
      result: message.subtype === 'success' ? run.lastResult : null,
      error: success
        ? null
        : message.subtype === 'success'
          ? message.result
          : message.errors.join('\n') || message.subtype,
      finishedAt: new Date().toISOString(),
    })
    addEvent(
      taskId,
      success ? 'result' : 'error',
      message.subtype === 'success' ? (run.lastResult ?? '') : `Остановлено: ${message.subtype}`,
    )
    // One result per run: closing the inbox ends the agent process and frees its memory
    run.inbox.close()
  }
}

const startTask = async (task: Task) => {
  const runs = state().runs
  updateTask(task.id, {
    status: 'running',
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  })

  const project = task.projectId ? getProject(task.projectId) : undefined
  if (!project) return fail(task.id, 'У задачи нет проекта')
  const workPath = projectWorkPath(project.id)
  if (!workPath) {
    return fail(task.id, `У проекта «${project.name}» и его подпроектов нет папки на диске`)
  }

  let cwd = task.cwd
  try {
    if (!cwd || !task.sessionId) {
      if (task.isolation === 'worktree' && !task.worktreePath) {
        const repo = await repoRoot(workPath)
        if (!repo)
          return fail(
            task.id,
            `${workPath} — не git-репозиторий, отдельный worktree создать нельзя. Выберите «Прямо в папке проекта» или подпроект с git`,
          )
        const { branch, worktree } = await createWorktree(repo, task.id, task.title)
        cwd = await pathInWorktree(repo, worktree, workPath)
        if (runnerSettings().allowEnvRead) {
          const linked = await linkEnvFiles(workPath, cwd)
          if (linked.length)
            addEvent(task.id, 'status', `В worktree подключены ${linked.join(', ')}`)
        }
        updateTask(task.id, {
          worktreePath: worktree,
          branch,
          baseCommit: await headCommit(worktree),
          cwd,
        })
        addEvent(task.id, 'status', `Создан worktree на ветке ${branch}`)
      } else {
        cwd = task.cwd ?? workPath
        updateTask(task.id, { cwd })
      }
    }
  } catch (error) {
    return fail(
      task.id,
      `Не удалось подготовить рабочую папку: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  let env: Record<string, string | undefined>
  try {
    env = await accountEnv(project.id)
  } catch (error) {
    return fail(task.id, error instanceof Error ? error.message : String(error))
  }

  const role = task.roleId ? getRole(task.roleId) : undefined
  const team = role ? getTeam(role.teamId) : undefined
  // A delegating team's lead gets the rest of the team as subagents
  const members = role?.isLead && team?.delegate ? team.roles.filter((r) => r.id !== role.id) : []
  const commonRules = getCommonRules()
  const needsMcp = [role, ...members].some((r) => r?.tools.includes(MCP_TOOL))
  const extras = state().extras?.(task) ?? null
  // Reading the project and its parents never needs a person; secrets stay off limits.
  // Rules use the //absolute path form, and Read rules also cover Grep and Glob
  const readRoots = projectReadRoots(project.id)
  const readRules = readRoots.map((root) => `Read(/${root}/**)`)
  // .env files are never changed by an agent; reading them is a setting
  const envReadable = runnerSettings().allowEnvRead
  const secretRules = readRoots.flatMap((root) => [
    `Edit(/${root}/**/.env*)`,
    `Write(/${root}/**/.env*)`,
    ...(envReadable ? [] : [`Read(/${root}/**/.env*)`]),
  ])
  const resumeText = state().followUps.get(task.id)
  state().followUps.delete(task.id)
  const resuming = Boolean(task.sessionId)
  const inbox = createInbox()
  // Images pasted into the task text go along with the first message, so the agent sees them
  const images = imageBlocks(resuming ? (resumeText ?? '') : task.description)
  const first = resuming ? (resumeText ?? 'Продолжай работу над задачей.') : initialPrompt(task)
  inbox.push(images.length ? [{ type: 'text', text: first }, ...images] : first)
  addEvent(
    task.id,
    'prompt',
    resuming ? (resumeText ?? 'Продолжай работу над задачей.') : initialPrompt(task),
  )

  const permissions = new Map<string, (result: PermissionResult) => void>()
  const stderr: string[] = []
  const parity = runnerSettings().terminalParity
  const cli = parity ? await terminalClaudePath() : null
  const q = query({
    prompt: inbox.messages,
    options: {
      cwd: cwd ?? workPath,
      // The terminal turns artifacts on by being interactive; an agent session needs the flag
      env: parity ? { ...env, CLAUDE_CODE_ARTIFACT: '1' } : env,
      ...(cli ? { pathToClaudeCodeExecutable: cli } : {}),
      ...(parity ? { settingSources: ['user', 'project', 'local'] } : {}),
      // A model picked for the task wins over the role's
      ...(task.model
        ? { model: task.model }
        : role && role.model !== 'inherit'
          ? { model: role.model }
          : {}),
      // A role sees only its listed tools; MCP servers only when the role or its team needs them
      ...(role && !parity
        ? {
            // Subagents can only use tools the session has, so a lead's session carries every
            // tool its team needs; otherwise members silently lose Bash and the like
            tools: [
              ...new Set([
                ...[role, ...members].flatMap((r) => r.tools.filter((t) => t !== MCP_TOOL)),
                ...(members.length ? ['Agent'] : []),
              ]),
            ],
          }
        : {}),
      ...(role && !needsMcp && !parity
        ? { strictMcpConfig: true, mcpServers: extras?.mcpServers ?? {} }
        : extras
          ? { mcpServers: extras.mcpServers }
          : {}),
      allowedTools: [...readRules, ...(extras?.allowedTools ?? [])],
      disallowedTools: secretRules,
      ...(members.length
        ? {
            agents: Object.fromEntries(
              members.map((m) => [m.id, subagent(m, commonRules, parity)]),
            ),
          }
        : {}),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: [
          role ? `# Твоя роль: ${role.title}\n\n${role.prompt}` : null,
          members.length ? teamBrief(members) : null,
          extras?.append ?? null,
          REPORT_FORMAT,
          RESOURCE_RULES,
          `# Общие правила\n\n${commonRules}`,
          // Lessons from past mistakes in this project, for this role and its team
          lessonsPrompt(
            task.projectId,
            [role?.id, ...members.map((m) => m.id)].filter((id) => id !== undefined),
          ),
        ]
          .filter((part) => part !== null)
          .join('\n\n'),
      },
      permissionMode: task.permissionMode,
      ...(task.budgetUsd ? { maxBudgetUsd: task.budgetUsd } : {}),
      ...(task.sessionId ? { resume: task.sessionId } : {}),
      stderr: (data) => {
        if (DEBUG) process.stderr.write(`[agent ${task.id.slice(0, 8)}] ${data}`)
        stderr.push(data)
        if (stderr.length > 40) stderr.shift()
      },
      canUseTool: async (toolName, input, options) => {
        // In auto mode reading is never a question, wherever the file is, except for secrets.
        // The mode is read now, so a switch made while the agent runs counts too
        if (
          getTask(task.id)?.permissionMode === 'auto' &&
          READ_TOOLS.has(toolName) &&
          !touchesSecret(input, runnerSettings().allowEnvRead)
        ) {
          addEvent(task.id, 'status', `Авто: разрешено чтение (${toolName})`)
          return { behavior: 'allow', updatedInput: input }
        }
        const id = createPermissionRequest(task.id, toolName, options.title ?? null, input)
        addEvent(task.id, 'permission', options.title ?? `Нужно разрешение: ${toolName}`, {
          toolName,
        })
        // In auto mode the architect and the lead decide first; the person can still answer
        // meanwhile, and whoever answers first wins
        const current = getTask(task.id)
        const personOnly = personOnlyReason(toolName, input)
        const byBoard =
          current?.permissionMode === 'auto' && runnerSettings().permissionBoard && !personOnly
        if (byBoard && current) {
          addEvent(
            task.id,
            'status',
            `Запрос решают ${boardNames(current.projectId)}, при разногласии — CTO`,
          )
          void decideByBoard(
            {
              task: current,
              agentTitle: role?.title ?? 'агент',
              toolName,
              title: options.title ?? null,
              input,
            },
            env,
          ).then((outcome) => {
            if (getPermissionRequest(id)?.status !== 'pending') return
            if (outcome.decision === 'human') {
              addEvent(task.id, 'status', `Совет передал запрос вам: ${outcome.note}`)
              updateTask(task.id, { status: 'waiting' })
              return
            }
            decidePermission(id, outcome.decision === 'allow', `решение совета: ${outcome.note}`)
          })
        } else {
          if (personOnly && current?.permissionMode === 'auto')
            addEvent(task.id, 'status', `Запрос только для человека: ${personOnly}`)
          updateTask(task.id, { status: 'waiting' })
        }
        return new Promise<PermissionResult>((resolve) => {
          permissions.set(id, resolve)
          options.signal.addEventListener('abort', () => {
            resolvePermissionRequest(id, false)
            permissions.delete(id)
            resolve({ behavior: 'deny', message: 'Запрос отменён' })
          })
        })
      },
    },
  })

  const run: Run = {
    taskId: task.id,
    query: q,
    inbox,
    permissions,
    stopping: false,
    background: new Set(),
    waitingForBackground: false,
    nudge: null,
    lastResult: null,
    announced: false,
  }
  runs.set(task.id, run)

  void (async () => {
    try {
      if (DEBUG) process.stderr.write(`[agent ${task.id.slice(0, 8)}] start ${cli ?? 'bundled'}\n`)
      for await (const message of q) {
        if (DEBUG) process.stderr.write(`[agent ${task.id.slice(0, 8)}] ${message.type}\n`)
        handleMessage(run, message)
      }
    } catch (error) {
      if (!run.stopping) {
        const tail = stderr.join('').trim().split('\n').slice(-5).join('\n')
        fail(
          task.id,
          `${error instanceof Error ? error.message : String(error)}${tail ? `\n${tail}` : ''}`,
        )
      }
    } finally {
      clearNudge(run)
      runs.delete(task.id)
      const current = getTask(task.id)
      // Process ended without a result: stopped by the human or died
      if (current && (current.status === 'running' || current.status === 'waiting')) {
        if (run.stopping) {
          updateTask(task.id, { status: 'cancelled', finishedAt: new Date().toISOString() })
          addEvent(task.id, 'status', 'Остановлено человеком')
        } else {
          fail(task.id, 'Агент завершился без результата')
        }
      }
      // Pipelines advance on this signal
      bus().emit('task-finished', { taskId: task.id })
      void tick()
    }
  })()
}

// Starts queued tasks while there is a free slot and enough free memory
export const tick = async () => {
  const s = state()
  if (s.ticking) return
  s.ticking = true
  try {
    const settings = runnerSettings()
    while (s.runs.size < settings.maxParallel) {
      const next = nextQueuedTask()
      if (!next) {
        s.heldBack = null
        break
      }
      const free = await freeMemoryPercent()
      if (free < settings.minFreeMemoryPercent) {
        s.heldBack = `Свободно ${free}% памяти — нужно не меньше ${settings.minFreeMemoryPercent}%`
        break
      }
      s.heldBack = null
      await startTask(next)
    }
    if (s.runs.size >= settings.maxParallel && nextQueuedTask()) {
      s.heldBack = `Заняты все ${settings.maxParallel} слота`
    }
  } finally {
    s.ticking = false
  }
}

export const startRunner = () => {
  const s = state()
  if (s.timer) return
  // Agent processes do not survive a dashboard restart: surface that instead of showing them as running
  for (const permission of pendingPermissions()) resolvePermissionRequest(permission.id, false)
  for (const status of ['running', 'waiting'] as const) {
    // A CTO task waiting on approval or on its leads has no agent of its own to lose
    for (const task of listTasksByStatus(status).filter(
      (t) => t.dispatch !== 'approval' && t.dispatch !== 'running',
    )) {
      fail(
        task.id,
        'Дашборд перезапускался, агент остановлен. Нажмите «Продолжить», чтобы возобновить сессию.',
      )
    }
  }
  s.timer = setInterval(() => void tick(), TICK_MS)
  void tick()
}

const listTasksByStatus = (status: Task['status']) => listTasks().filter((t) => t.status === status)

export const runnerStatus = async () => {
  const settings = runnerSettings()
  return {
    running: state().runs.size,
    maxParallel: settings.maxParallel,
    freeMemoryPercent: await freeMemoryPercent(),
    minFreeMemoryPercent: settings.minFreeMemoryPercent,
    heldBack: state().heldBack,
  }
}

export const isRunning = (taskId: string) => state().runs.has(taskId)

export const queueTask = (taskId: string) => {
  assertRunner()
  updateTask(taskId, { status: 'todo', error: null })
  addEvent(taskId, 'status', 'Поставлена в очередь')
  void tick()
}

// A message to the agent: delivered live if it is running, otherwise resumes its session
export const sendToTask = (taskId: string, text: string) => {
  assertRunner()
  const run = state().runs.get(taskId)
  if (run) {
    const images = imageBlocks(text)
    run.inbox.push(images.length ? [{ type: 'text', text }, ...images] : text)
    addEvent(taskId, 'prompt', text)
    return
  }
  state().followUps.set(taskId, text)
  queueTask(taskId)
}

export const stopTask = async (taskId: string) => {
  assertRunner()
  const run = state().runs.get(taskId)
  if (!run) {
    const task = getTask(taskId)
    if (task?.status === 'todo') {
      updateTask(taskId, { status: 'inbox' })
      addEvent(taskId, 'status', 'Убрана из очереди')
    }
    return
  }
  run.stopping = true
  for (const [id, resolve] of run.permissions) {
    resolvePermissionRequest(id, false)
    resolve({ behavior: 'deny', message: 'Задача остановлена человеком', interrupt: true })
  }
  run.permissions.clear()
  await run.query.interrupt().catch(() => undefined)
  run.inbox.close()
  run.query.close()
}

export const decidePermission = (permissionId: string, allow: boolean, note?: string) => {
  assertRunner()
  const request = getPermissionRequest(permissionId)
  if (!request || request.status !== 'pending') return
  resolvePermissionRequest(permissionId, allow)
  const run = state().runs.get(request.taskId)
  const resolve = run?.permissions.get(permissionId)
  run?.permissions.delete(permissionId)
  addEvent(
    request.taskId,
    'permission',
    `${allow ? 'Разрешено' : 'Отклонено'}: ${request.title ?? request.toolName}${note ? ` — ${note}` : ''}`,
    { toolName: request.toolName },
  )
  resolve?.(
    allow
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: note || 'Человек отклонил это действие' },
  )
  if (run && !run.permissions.size) updateTask(request.taskId, { status: 'running' })
}

// Switches a task's permission mode; a running agent picks it up at once, without a restart
export const setTaskPermissionMode = async (taskId: string, mode: TaskPermissionMode) => {
  assertRunner()
  const task = getTask(taskId)
  if (!task || task.permissionMode === mode) return
  setPermissionModeColumn(taskId, mode)
  const run = state().runs.get(taskId)
  if (run) await run.query.setPermissionMode(mode)
  addEvent(
    taskId,
    'status',
    `Режим разрешений: ${mode}${run ? ' (применён к работающему агенту)' : ''}`,
  )
}
