import type { Metadata } from 'next'
import { Geist, Geist_Mono, Unbounded } from 'next/font/google'

import { CommandPalette } from '@/components/CommandPalette'
import { IndexStatus } from '@/components/IndexStatus'
import { Nav } from '@/components/Nav'
import { Robot } from '@/components/Robot'
import { SidebarShell } from '@/components/SidebarShell'
import { SpotlightTracker } from '@/components/SpotlightTracker'
import { ThemeToggle } from '@/components/ThemeToggle'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import { THEME_INIT_SCRIPT } from '@/lib/theme'
import { projectOptions } from '@/server/projects'
import { UI_ONLY } from '@/server/runner'
import { readView, visibleRoles } from '@/server/visibility'

import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'cyrillic'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin', 'cyrillic'] })
const unbounded = Unbounded({ variable: '--font-unbounded', subsets: ['latin', 'cyrillic'] })

export const metadata: Metadata = {
  title: 'Agent Control',
  description: 'Наблюдение и управление ИИ-агентами',
}

export const dynamic = 'force-dynamic'

const RootLayout = async (props: Readonly<{ children: React.ReactNode }>) => {
  const view = await readView()
  const roles = visibleRoles(view).map((r) => ({ id: r.id, title: r.title, teamId: r.teamId }))
  // Hidden projects are not offered as a workspace
  const workspaces = projectOptions().filter((p) => !view.hidden.has(p.id))
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${unbounded.variable} antialiased`}
      >
        <div className="flex min-h-dvh flex-col md:flex-row">
          <SidebarShell
            header={
              <>
                <Robot seed="agent-control" state="idle" size={30} />
                <span className="font-display text-gradient text-[15px] font-semibold">
                  Agent Control
                </span>
                <span className="ml-auto">
                  <ThemeToggle />
                </span>
              </>
            }
          >
            <WorkspaceSwitcher current={view.workspaceId} projects={workspaces} />
            <Nav />
            <div className="mt-3 px-2.5 md:mt-auto">
              <IndexStatus />
            </div>
          </SidebarShell>
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
            {UI_ONLY && (
              <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
                Только просмотр: этот сервер не управляет агентами. Разрешения, запуск и режимы — на
                основном адресе :4400.
              </p>
            )}
            {props.children}
          </main>
        </div>
        <CommandPalette roles={roles} />
        <SpotlightTracker />
      </body>
    </html>
  )
}

export default RootLayout
