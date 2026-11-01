'use client'

import { CornerDownLeft, Moon, Plus, Search, Sun } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { NAV_ITEMS } from '@/lib/nav'

import { Robot } from './Robot'
import { setTheme } from './ThemeToggle'

type RoleOption = { id: string; title: string; teamId: string }

type Command = {
  id: string
  label: string
  hint: string
  group: string
  icon: React.ReactNode
  run: () => void
}

export const CommandPalette = (props: { roles: RoleOption[] }) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const openRef = useRef(false)

  useEffect(() => {
    // Every opening starts from an empty search
    const show = () => {
      setQuery('')
      setActive(0)
      setOpen(true)
    }
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (openRef.current) setOpen(false)
        else show()
      }
      if (event.key === 'Escape') setOpen(false)
    }
    const onOpen = show
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen)
    }
  }, [])

  useEffect(() => {
    openRef.current = open
    if (open) requestAnimationFrame(() => input.current?.focus())
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      setOpen(false)
      router.push(href)
    }
    return [
      {
        id: 'new-task',
        label: 'Новая задача',
        hint: 'Агент в отдельном worktree',
        group: 'Действия',
        icon: <Plus size={16} aria-hidden />,
        run: go('/tasks#new-task'),
      },
      {
        id: 'new-pipeline',
        label: 'Новый конвейер',
        hint: 'Анализ → план → разработка → ревью',
        group: 'Действия',
        icon: <Plus size={16} aria-hidden />,
        run: go('/pipelines#new-pipeline'),
      },
      {
        id: 'theme-dark',
        label: 'Тёмная тема',
        hint: 'Центр управления',
        group: 'Действия',
        icon: <Moon size={16} aria-hidden />,
        run: () => {
          setTheme('dark')
          setOpen(false)
        },
      },
      {
        id: 'theme-light',
        label: 'Светлая тема',
        hint: 'Лаборатория',
        group: 'Действия',
        icon: <Sun size={16} aria-hidden />,
        run: () => {
          setTheme('light')
          setOpen(false)
        },
      },
      ...NAV_ITEMS.map((item) => {
        const Icon = item.icon
        return {
          id: item.href,
          label: item.label,
          hint: item.hint,
          group: 'Разделы',
          icon: <Icon size={16} aria-hidden />,
          run: go(item.href),
        }
      }),
      ...props.roles.map((role) => ({
        id: `role-${role.id}`,
        label: role.title,
        hint: role.id,
        group: 'Агенты',
        icon: <Robot seed={role.id} team={role.teamId} size={18} />,
        run: go(`/agents/${role.id}`),
      })),
    ]
  }, [props.roles, router])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q)) : commands
  }, [commands, query])

  if (!open) return null

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(filtered.length - 1, i + 1))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    }
    if (event.key === 'Enter') filtered[active]?.run()
  }

  let lastGroup = ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Командная палитра"
        className="glass page-enter w-full max-w-xl overflow-hidden rounded-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} className="shrink-0 text-text-3" aria-hidden />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Куда перейти или что сделать…"
            aria-label="Поиск команды"
            aria-controls="command-list"
            aria-activedescendant={filtered[active] ? `cmd-${filtered[active].id}` : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-3"
          />
          <kbd className="rounded border border-border px-1.5 text-[11px] text-text-3">Esc</kbd>
        </div>
        <ul id="command-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null
            lastGroup = command.group
            return (
              <li key={command.id} role="presentation">
                {header && (
                  <div className="px-2 pt-2 pb-1 text-[11px] tracking-wider text-text-3 uppercase">
                    {header}
                  </div>
                )}
                <button
                  id={`cmd-${command.id}`}
                  role="option"
                  aria-selected={index === active}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={command.run}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${
                    index === active ? 'bg-accent-soft text-text' : 'text-text-2'
                  }`}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center text-accent">
                    {command.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  <span className="truncate text-xs text-text-3">{command.hint}</span>
                  {index === active && (
                    <CornerDownLeft size={14} className="text-text-3" aria-hidden />
                  )}
                </button>
              </li>
            )
          })}
          {!filtered.length && (
            <li className="px-3 py-6 text-center text-sm text-text-3">Ничего не нашлось</li>
          )}
        </ul>
      </div>
    </div>
  )
}
