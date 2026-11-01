import { CheckCircle2, ChevronRight, CircleAlert, CircleDashed, EyeOff, Folder } from 'lucide-react'
import Link from 'next/link'

import { Card, PageHeader } from '@/components/ui'
import { shortPath } from '@/lib/format'
import { flattenTree, projectTree } from '@/server/projects'
import { terminalClaudePath } from '@/server/claudeCli'
import { runnerSettings } from '@/server/settings'
import { HOOK_COMMAND, HOOK_EVENTS, hookStatus, type HookStatus } from '@/server/hookInstall'
import { readView, visibleAccounts } from '@/server/visibility'

import { installHooksAction, saveRunnerSettingsAction, uninstallHooksAction } from './actions'

const StatusLine = (props: { status: HookStatus }) => {
  const s = props.status
  if (s.state === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-critical">
        <CircleAlert size={15} aria-hidden /> Не удалось прочитать settings.json: {s.message}
      </span>
    )
  }
  if (s.state === 'installed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-good">
        <CheckCircle2 size={15} aria-hidden /> Установлены ({s.installed} из {s.total} событий)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-text-2">
      <CircleDashed size={15} aria-hidden />
      {s.state === 'partial'
        ? `Установлены частично (${s.installed} из ${s.total})`
        : 'Не установлены'}
    </span>
  )
}

const button = 'rounded-md px-3 py-1.5 text-sm font-medium'

const field = 'w-24 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text'

const SettingsPage = async () => {
  const view = await readView()
  const accounts = visibleAccounts(view).filter((a) => a.kind === 'subscription' && a.configDir)
  // Every project is listed here, hidden ones too: this is where they come back from
  const projects = flattenTree(projectTree())
  const runner = runnerSettings()
  const claudePath = await terminalClaudePath()

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Хуки Claude Code отправляют события сессий в дашборд — на них работает страница Live"
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="flex flex-col gap-3 xl:col-span-3">
          <Card
            title="Проекты"
            hint="Папка, аккаунт, команды и видимость каждого проекта. Скрытые проекты видны только здесь"
          >
            <ul className="flex flex-col">
              {projects.map((node) => (
                <li key={node.id} className="border-b border-border last:border-0">
                  <Link
                    href={`/settings/projects/${node.id}`}
                    className="flex items-center gap-2 py-2 text-sm hover:text-accent"
                    style={{ paddingLeft: node.depth * 20 }}
                  >
                    <Folder size={15} className="shrink-0 text-text-3" aria-hidden />
                    <span
                      className={`min-w-0 flex-1 truncate font-medium ${view.hidden.has(node.id) ? 'text-text-3' : ''}`}
                    >
                      {node.name}
                    </span>
                    {view.hidden.has(node.id) && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-2">
                        <EyeOff size={12} aria-hidden /> скрыт
                      </span>
                    )}
                    <ChevronRight size={15} className="shrink-0 text-text-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title="Запуск агентов"
            hint="Диспетчер не стартует новую задачу, если заняты все слоты или мало свободной памяти"
          >
            <form action={saveRunnerSettingsAction} className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1 text-xs text-text-2">
                Агентов одновременно
                <input
                  name="maxParallel"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={runner.maxParallel}
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-2">
                Минимум свободной памяти, %
                <input
                  name="minFreeMemoryPercent"
                  type="number"
                  min={0}
                  max={90}
                  defaultValue={runner.minFreeMemoryPercent}
                  className={field}
                />
              </label>
              <label className="flex items-center gap-2 self-center text-sm text-text-2">
                <input
                  type="checkbox"
                  name="allowEnvRead"
                  defaultChecked={runner.allowEnvRead}
                  className="accent-accent"
                />
                Агенты могут читать .env проектов (менять — никогда)
              </label>
              <label className="flex basis-full items-start gap-2 text-sm text-text-2">
                <input
                  type="checkbox"
                  name="terminalParity"
                  defaultChecked={runner.terminalParity}
                  className="mt-1 accent-accent"
                />
                <span>
                  Агенты как сессия в терминале: тот же claude
                  {claudePath ? (
                    <code className="mx-1 text-xs text-text-3">{claudePath}</code>
                  ) : (
                    ' (не найден — будет встроенный в SDK) '
                  )}
                  , все инструменты (артефакты, скиллы, воркфлоу), MCP и ваши настройки. Списки
                  инструментов у ролей перестают ограничивать.
                </span>
              </label>
              <label className="flex basis-full items-start gap-2 text-sm text-text-2">
                <input
                  type="checkbox"
                  name="permissionBoard"
                  defaultChecked={runner.permissionBoard}
                  className="mt-1 accent-accent"
                />
                <span>
                  В авто-режиме запросы разрешений сначала решают архитектор и лид проекта, при
                  разногласии — CTO. Вам приходит только то, где нужен человек: публикация наружу,
                  push и merge, вход и креды.
                </span>
              </label>
              <button type="submit" className={'btn-primary'}>
                Сохранить
              </button>
            </form>
          </Card>
          {accounts.map((account) => {
            const dir = account.configDir ?? ''
            const status = hookStatus(dir)
            return (
              <Card key={account.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{account.name}</div>
                    <div className="font-mono text-xs text-text-3">
                      {shortPath(dir)}/settings.json
                    </div>
                    <div className="mt-1.5">
                      <StatusLine status={status} />
                    </div>
                  </div>
                  {status.state !== 'error' && (
                    <div className="flex gap-2">
                      {status.state !== 'installed' && (
                        <form action={installHooksAction.bind(null, account.id)}>
                          <button type="submit" className={'btn-primary'}>
                            Установить хуки
                          </button>
                        </form>
                      )}
                      {status.state !== 'missing' && (
                        <form action={uninstallHooksAction.bind(null, account.id)}>
                          <button
                            type="submit"
                            className={`${button} border border-border text-text-2 hover:text-critical`}
                          >
                            Удалить
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>

        <Card title="Что делает хук" className="h-fit xl:col-span-2">
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-text-2">
            <li>
              На каждое событие сессии ({HOOK_EVENTS.length} видов: промпт, вызов инструмента,
              субагенты, запросы разрешений, конец хода) отправляет его JSON на локальный адрес
              дашборда.
            </li>
            <li>
              Работает в фоне (<code className="font-mono text-xs">async</code>) и не ждёт ответа —
              если дашборд выключен, сессия этого не заметит.
            </li>
            <li>
              Перед изменением рядом сохраняется копия{' '}
              <code className="font-mono text-xs">settings.json.bak-agent-control-…</code>; ваши
              другие хуки не трогаются, наши помечены и удаляются одной кнопкой.
            </li>
            <li>Действует в новых сессиях Claude Code.</li>
          </ul>
          <pre className="mt-3 overflow-x-auto rounded-md bg-surface-2 p-2.5 font-mono text-[11px] whitespace-pre-wrap break-all text-text-2">
            {HOOK_COMMAND}
          </pre>
        </Card>
      </div>
    </>
  )
}

export default SettingsPage
