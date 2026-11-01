'use client'

import { Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { THEME_STORAGE_KEY } from '@/lib/theme'

const readTheme = () => (document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark')

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

export const setTheme = (theme: 'light' | 'dark') => {
  document.documentElement.dataset['theme'] = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private mode: the choice lasts for this page only
  }
}

export const ThemeToggle = () => {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'dark')
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-lg p-1.5 text-text-3 hover:bg-surface-2 hover:text-text"
      aria-label={next === 'light' ? 'Светлая тема' : 'Тёмная тема'}
      title={next === 'light' ? 'Светлая тема' : 'Тёмная тема'}
    >
      {theme === 'dark' ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  )
}
