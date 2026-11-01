import { KeyRound, Trash2, UserRound } from 'lucide-react'

import { Select } from '@/components/Select'
import { Card, PageHeader } from '@/components/ui'
import { shortPath } from '@/lib/format'
import { hasApiKey } from '@/server/keychain'
import { flattenTree, projectTree } from '@/server/projects'
import { readView, visibleAccounts } from '@/server/visibility'

import { createAccountAction, deleteAccountAction, saveApiKeyAction } from './actions'

const field = 'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text'
const label = 'flex flex-col gap-1 text-xs text-text-2'

const AccountsPage = async () => {
  const view = await readView()
  const accounts = visibleAccounts(view)
  const nodes = flattenTree(projectTree()).filter((node) => view.allowsProject(node.id))
  const keyStored = new Map(
    await Promise.all(
      accounts
        .filter((a) => a.kind === 'api_key')
        .map(async (a) => [a.id, await hasApiKey(a.id)] as const),
    ),
  )

  return (
    <>
      <PageHeader
        title="Аккаунты"
        description="Подписки и API-ключи. Каждому проекту можно назначить свой аккаунт — агенты проекта будут работать от его имени."
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="flex flex-col gap-3 xl:col-span-3">
          {accounts.map((account) => {
            const usedBy = nodes.filter((n) => n.accountId === account.id)
            const Icon = account.kind === 'subscription' ? UserRound : KeyRound
            return (
              <Card key={account.id}>
                <div className="flex items-start gap-3">
                  <Icon size={18} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{account.name}</div>
                    <div className="text-xs text-text-2">
                      {account.kind === 'subscription' ? 'Подписка Claude' : 'API-ключ Anthropic'}
                      {account.configDir && (
                        <span className="ml-1.5 font-mono text-text-3">
                          {shortPath(account.configDir)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 text-xs text-text-3">
                      {usedBy.length
                        ? `Назначен проектам: ${usedBy.map((n) => n.name).join(', ')}`
                        : account.id === 'default'
                          ? 'Используется по умолчанию для проектов без своего аккаунта'
                          : 'Пока не назначен ни одному проекту'}
                    </div>
                    {account.kind === 'api_key' && (
                      <form
                        action={saveApiKeyAction.bind(null, account.id)}
                        className="mt-3 flex flex-wrap items-center gap-2"
                      >
                        <span
                          className={`text-xs ${keyStored.get(account.id) ? 'text-good' : 'text-warning'}`}
                        >
                          {keyStored.get(account.id) ? 'Ключ в Связке ключей' : 'Ключ не задан'}
                        </span>
                        <input
                          type="password"
                          name="key"
                          required
                          autoComplete="off"
                          aria-label={`API-ключ для ${account.name}`}
                          placeholder={keyStored.get(account.id) ? 'Заменить ключ' : 'sk-ant-…'}
                          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-xs"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-accent"
                        >
                          Сохранить
                        </button>
                      </form>
                    )}
                  </div>
                  {account.id !== 'default' && (
                    <form action={deleteAccountAction.bind(null, account.id)}>
                      <button
                        type="submit"
                        className="rounded p-1 text-text-3 hover:bg-surface-2 hover:text-critical"
                        aria-label={`Удалить аккаунт ${account.name}`}
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </form>
                  )}
                </div>
              </Card>
            )
          })}
        </div>

        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card title="Добавить аккаунт">
            <form action={createAccountAction} className="flex flex-col gap-3">
              <label className={label}>
                Название
                <input name="name" required placeholder="Личная подписка" className={field} />
              </label>
              <label className={label}>
                Тип
                <Select
                  name="kind"
                  defaultValue="subscription"
                  options={[
                    { value: 'subscription', label: 'Подписка Claude' },
                    { value: 'api_key', label: 'API-ключ Anthropic' },
                  ]}
                />
              </label>
              <label className={label}>
                Папка конфигурации (для подписки)
                <input
                  name="configDir"
                  placeholder="~/.claude-accounts/work"
                  className={`${field} font-mono`}
                />
              </label>
              <button type="submit" className="w-fit btn-primary">
                Добавить
              </button>
            </form>
          </Card>
          <Card title="Как подключить вторую подписку">
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-text-2">
              <li>
                Войдите в Claude Code в отдельной папке:
                <code className="mt-1 block rounded bg-surface-2 px-2 py-1 font-mono text-xs text-text">
                  CLAUDE_CONFIG_DIR=~/.claude-accounts/work claude
                </code>
                и выполните <code className="font-mono text-xs">/login</code> под нужным аккаунтом.
              </li>
              <li>Добавьте аккаунт здесь с этой папкой — её сессии попадут в аналитику.</li>
              <li>
                Назначьте аккаунт проекту. Агенты, запущенные из дашборда, будут работать под ним.
              </li>
            </ol>
            <p className="mt-3 text-xs text-text-3">
              API-ключи хранятся в Связке ключей macOS (служба agent-control), не в базе и не в
              файлах — дашборд читает ключ только в момент запуска агента.
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}

export default AccountsPage
