import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { obj, str } from '@/lib/json'

import { db, now } from './db'

export type AccountKind = 'subscription' | 'api_key'

export type Account = {
  id: string
  name: string
  kind: AccountKind
  configDir: string | null
}

const isKind = (value: unknown): value is AccountKind =>
  value === 'subscription' || value === 'api_key'

export const listAccounts = (): Account[] =>
  db()
    .prepare('SELECT * FROM accounts ORDER BY created_at')
    .all()
    .flatMap((row) => {
      const r = obj(row)
      const id = str(r?.['id'])
      const name = str(r?.['name'])
      const kind = r?.['kind']
      if (!id || !name || !isKind(kind)) return []
      return [{ id, name, kind, configDir: str(r?.['config_dir']) ?? null }]
    })

const expandHome = (value: string) =>
  value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value

export const createAccount = (input: {
  name: string
  kind: AccountKind
  configDir: string | null
}) => {
  db()
    .prepare('INSERT INTO accounts (id, name, kind, config_dir, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(
      randomUUID(),
      input.name.trim(),
      input.kind,
      input.configDir ? path.resolve(expandHome(input.configDir.trim())) : null,
      now(),
    )
}

export const deleteAccount = (id: string) => {
  if (id === 'default') throw new Error('Основной аккаунт удалить нельзя')
  db().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
