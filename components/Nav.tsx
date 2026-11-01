'use client'

import { Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { NAV_ITEMS } from '@/lib/nav'

export const Nav = () => {
  const pathname = usePathname()
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
        // Phones open search from the icon in the header
        className="hidden items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-left text-sm text-text-3 hover:border-border-strong hover:text-text-2 md:flex"
      >
        <Search size={14} aria-hidden />
        <span className="flex-1">Поиск и команды</span>
        <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
      <nav aria-label="Разделы" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
                active
                  ? 'bg-gradient-to-r from-accent-soft to-transparent font-medium text-text'
                  : 'text-text-2 hover:bg-surface-2 hover:text-text'
              }`}
            >
              {active && (
                <span
                  className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]"
                  aria-hidden
                />
              )}
              <Icon
                size={16}
                className={active ? 'text-accent' : 'text-text-3 group-hover:text-text-2'}
                aria-hidden
              />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
