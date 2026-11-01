'use client'

import { Menu, Search, X } from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'

type Props = {
  // Logo row: always visible
  header: ReactNode
  // Workspace, navigation and index status: a fold-out menu on phones, the sidebar on desktop
  children: ReactNode
}

export const SidebarShell = (props: Props) => {
  const [open, setOpen] = useState(false)

  // Following a link closes the phone menu
  const onPanelClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('a')) setOpen(false)
  }

  return (
    <aside className="glass sticky top-0 z-30 border-0 border-b px-4 py-2.5 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:px-3 md:py-4">
      <div className="flex items-center gap-2 md:mb-4 md:px-1.5">
        {props.header}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          className="rounded-md p-1.5 text-text-2 hover:bg-surface-2 hover:text-text md:hidden"
          aria-label="Поиск и команды"
        >
          <Search size={18} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md p-1.5 text-text-2 hover:bg-surface-2 hover:text-text md:hidden"
          aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={open}
          aria-controls="sidebar-panel"
        >
          {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
      </div>
      <div
        id="sidebar-panel"
        onClick={onPanelClick}
        className={`${open ? 'flex' : 'hidden'} max-h-[75dvh] flex-col overflow-y-auto pt-3 md:flex md:max-h-none md:flex-1 md:overflow-visible md:pt-0`}
      >
        {props.children}
      </div>
    </aside>
  )
}
