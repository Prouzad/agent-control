import { MODEL_GUIDE } from './roles'

export const VERDICT_APPROVED = 'ВЕРДИКТ: ОДОБРЕНО'
export const VERDICT_REWORK = 'ВЕРДИКТ: ДОРАБОТАТЬ'

export const VERDICT_TO_CTO = 'ВЕРДИКТ: К CTO'
export const VERDICT_TO_HUMAN = 'ВЕРДИКТ: К ЧЕЛОВЕКУ'

// For the architect, the development lead and the CTO when they decide instead of the person
export const BOARD_VERDICT_RULE = [
  'Последней строкой ответа напиши ровно один вердикт:',
  `- «${VERDICT_APPROVED}» — принимаешь;`,
  `- «${VERDICT_REWORK}» — нужна доработка, перед вердиктом перечисли, что исправить;`,
  `- «${VERDICT_TO_CTO}» — решение выше твоего уровня: архитектура нескольких модулей или команд, сроки, бюджет, риск для других команд, или вы со вторым проверяющим расходитесь (CTO этот вердикт не ставит);`,
  `- «${VERDICT_TO_HUMAN}» — без человека нельзя: вход или креды, доступы, решение продукта или денег. Перед вердиктом напиши, что именно нужно от человека.`,
].join('\n')

export const VERDICT_RULE = `Последней строкой ответа напиши ровно одно из двух: «${VERDICT_APPROVED}» или «${VERDICT_REWORK}». При «доработать» перед вердиктом перечисли, что именно исправить.`

export type StageDef = {
  key: string
  kind: 'agent' | 'gate'
  label: string
  // Default role; the development stage takes the role picked when the pipeline is created
  roleId?: string
  // Checks end with a verdict and can send the work back to development
  check?: boolean
  // Where a rejected gate sends the work back to
  reworkTo?: string
  // Only the person decides here; other gates go to the architect and the development lead
  humanOnly?: boolean
  instruction?: string
  defaultOn: boolean
}

export const STAGES: StageDef[] = [
  {
    key: 'pm',
    kind: 'agent',
    label: 'PM: истории и критерии приёмки',
    roleId: 'product-manager',
    instruction:
      'Сформулируй требования: проблему, user stories, критерии приёмки (Given/When/Then) и что не входит в задачу. Файлы не меняй.',
    defaultOn: true,
  },
  {
    key: 'analyst',
    kind: 'agent',
    label: 'Аналитика: спецификация',
    roleId: 'system-analyst',
    instruction:
      'Изучи код и опиши спецификацию: затрагиваемые сущности, поля, контракты API, состояния, валидацию, тексты ошибок. Файлы не меняй.',
    defaultOn: true,
  },
  {
    key: 'architect',
    kind: 'agent',
    label: 'Архитектор: план решения',
    roleId: 'architect',
    instruction: `Составь технический план: какие файлы создать или изменить и как, контракты, риски, порядок шагов. План должен быть достаточным, чтобы разработчик сделал всё без догадок. Файлы не меняй.\nУ каждого шага укажи модель (sonnet, opus или fable) и одной фразой — почему: лид передаст её исполнителю.\n${MODEL_GUIDE}`,
    defaultOn: true,
  },
  {
    key: 'plan_gate',
    kind: 'gate',
    label: 'Ваше одобрение плана',
    reworkTo: 'architect',
    defaultOn: true,
  },
  {
    key: 'design',
    kind: 'agent',
    label: 'Дизайн: состояния и сверка с макетом',
    roleId: 'ui-designer',
    instruction:
      'Опиши все состояния интерфейса для этой задачи и требования к вёрстке; если есть макет — сверь план с ним. Файлы не меняй.',
    defaultOn: false,
  },
  {
    key: 'dev',
    kind: 'agent',
    label: 'Разработка',
    roleId: 'frontend-lead',
    instruction:
      'Реализуй задачу по плану. Поручая шаг участнику команды, передавай в Agent модель, которую план указал для этого шага. Прогони проверки проекта (lint, типы, тесты, сборка), исправь найденное. Закоммить изменения в текущую ветку с сообщением на английском. Не пушь и не мержи.',
    defaultOn: true,
  },
  {
    key: 'review',
    kind: 'agent',
    label: 'Code Review',
    roleId: 'lead-reviewer',
    check: true,
    instruction: `Сделай ревью изменений ветки (git diff BASE_COMMIT): корректность, соответствие плану и правилам проекта. Файлы не меняй. ${VERDICT_RULE}`,
    defaultOn: true,
  },
  {
    key: 'ui_check',
    kind: 'agent',
    label: 'UI-проверка',
    roleId: 'manual-tester',
    check: true,
    instruction: `Проверь интерфейс изменённых экранов вживую. Подними фронт ветки (или используй уже поднятый), открой экраны в браузере через MCP Chrome и сними скриншоты на ширинах 375, 768, 1280 и 1440. Сверь с макетом (картинка к картинке, если есть ссылка на Figma): композиция, отступы, шрифты, тексты и переводы, состояния (пусто, загрузка, ошибка, длинные данные), тёмная тема, клавиатура и фокус. Поднятый dev-сервер ветки оставь работать для QA и напиши в отчёте его порт; вкладки закрой. Файлы не меняй. ${VERDICT_RULE}`,
    defaultOn: true,
  },
  {
    key: 'qa',
    kind: 'agent',
    label: 'QA по тест-плану',
    roleId: 'qa-lead',
    check: true,
    instruction: `Составь короткий тест-план по критериям приёмки и выполни все доступные проверки (тесты, lint, сборка, сценарии). Если UI-проверка оставила dev-сервер ветки — используй его, а в конце останови dev-сервер ветки, кто бы его ни поднял. Файлы не меняй. ${VERDICT_RULE}`,
    defaultOn: true,
  },
  {
    key: 'security',
    kind: 'agent',
    label: 'Безопасность',
    roleId: 'appsec-reviewer',
    check: true,
    instruction: `Проверь изменения ветки (git diff BASE_COMMIT) на уязвимости. Файлы не меняй. ${VERDICT_RULE}`,
    defaultOn: false,
  },
  {
    key: 'release',
    kind: 'agent',
    label: 'Релиз: описание PR и changelog',
    roleId: 'release-manager',
    instruction:
      'Подготовь текстом описание PR и запись для changelog по изменениям ветки (git log BASE_COMMIT..HEAD). Ничего не пушь, не мержи и не меняй файлы.',
    defaultOn: true,
  },
  {
    key: 'release_gate',
    kind: 'gate',
    label: 'Ваше одобрение релиза',
    reworkTo: 'dev',
    humanOnly: true,
    defaultOn: true,
  },
]

export const TEMPLATES = [
  {
    key: 'full',
    label: 'Полный конвейер',
    stages: STAGES.filter((s) => s.defaultOn).map((s) => s.key),
  },
  {
    key: 'quick',
    label: 'Быстрый: разработка → ревью → QA',
    stages: ['dev', 'review', 'ui_check', 'qa', 'release_gate'],
  },
  {
    key: 'analysis',
    label: 'Только анализ: PM → аналитик → архитектор',
    stages: ['pm', 'analyst', 'architect'],
  },
] as const

export const stageDef = (key: string) => STAGES.find((s) => s.key === key)

// The verdict is the last verdict line the agent wrote; anything else counts as unclear
export const parseVerdict = (
  text: string | null,
): 'approved' | 'rework' | 'cto' | 'human' | null => {
  if (!text) return null
  const lines = text.trim().split('\n').reverse()
  const line = lines.find((l) => l.includes('ВЕРДИКТ'))
  if (!line) return null
  if (line.includes('ЧЕЛОВЕК')) return 'human'
  if (line.includes('CTO')) return 'cto'
  if (line.includes('ДОРАБОТАТЬ')) return 'rework'
  if (line.includes('ОДОБРЕНО')) return 'approved'
  return null
}

export const MAX_REWORK_ROUNDS = 2
