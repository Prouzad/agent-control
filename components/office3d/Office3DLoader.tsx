'use client'

import dynamic from 'next/dynamic'

import type { Idler, OfficeStage, TeamInfo } from './Office3D'

export type { Idler, OfficeStage, TeamInfo }

// WebGL lives in the browser only, so the scene is loaded without server rendering
export const Office3DLoader = dynamic(() => import('./Office3D').then((m) => m.Office3D), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-[2/1] items-center justify-center rounded-2xl bg-surface-2 text-sm text-text-3">
      Загружаю офис…
    </div>
  ),
})
