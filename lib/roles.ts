// Pseudo-tool: lets the role use the MCP servers from the user's and project's settings
export const MCP_TOOL = 'MCP'

// Claude Code tool names a role can be granted
export const TOOLS = [
  { name: 'Read', label: 'Чтение файлов' },
  { name: 'Grep', label: 'Поиск по коду' },
  { name: 'Glob', label: 'Поиск файлов' },
  { name: 'Edit', label: 'Правка файлов' },
  { name: 'Write', label: 'Создание файлов' },
  { name: 'Bash', label: 'Терминал' },
  { name: 'WebFetch', label: 'Чтение веб-страниц' },
  { name: 'WebSearch', label: 'Веб-поиск' },
  { name: 'NotebookEdit', label: 'Jupyter-ноутбуки' },
  { name: MCP_TOOL, label: 'MCP-серверы (Figma, браузер и др.)' },
] as const

export const MODELS = [
  { value: 'inherit', label: 'Как у запускающего' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
] as const

// Models a single task or sub-agent call can be pinned to, over the role's own model
export const TASK_MODELS = ['sonnet', 'opus', 'fable', 'haiku'] as const
export type TaskModel = (typeof TASK_MODELS)[number]
export const isTaskModel = (value: unknown): value is TaskModel =>
  TASK_MODELS.some((m) => m === value)

// How leads, the CTO and the architect pick a model for a piece of work
export const MODEL_GUIDE = [
  'Модель подбирай под сложность работы, а не по привычке:',
  '- sonnet — понятная работа по готовому плану: вёрстка по образцу, ключи локалей, типовые правки, тесты по шаблону, механический рефакторинг;',
  '- opus — работа с решениями: новая логика, интеграция с API, формы с валидацией, неочевидные баги, ревью;',
  '- fable — самое трудное: архитектура на много модулей, запутанные гонки и состояние, задачи, где opus уже не справился;',
  '- haiku — только мелочь: поиск по коду, сводка, переименование.',
  'Сомневаешься между двумя — бери более сильную.',
].join('\n')

export type ModelChoice = (typeof MODELS)[number]['value']

export const isModelChoice = (value: string): value is ModelChoice =>
  MODELS.some((m) => m.value === value)

export const modelChoiceLabel = (value: string) =>
  MODELS.find((m) => m.value === value)?.label ?? value

// Tool sets used by the starter roles
export const READ_ONLY = ['Read', 'Grep', 'Glob']
export const RESEARCH = [...READ_ONLY, 'WebFetch', 'WebSearch']
export const BUILD = [...READ_ONLY, 'Edit', 'Write', 'Bash']
export const BUILD_WEB = [...BUILD, 'WebFetch', 'WebSearch']
// Reviewers and auditors may run checks but never change files
export const VERIFY = [...READ_ONLY, 'Bash']
