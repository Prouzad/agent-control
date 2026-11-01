'use client'

import { Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

const HASH = '#new-pipeline'

// The new-pipeline form in a dialog. It opens from the button, from any link to #new-pipeline
// (command palette, «Запустить как конвейер», «Запустить заново») and by itself when the form
// comes prefilled from a task or an earlier pipeline
export const NewPipelineModal = (props: {
  title: string
  hint?: string
  prefilled: boolean
  children: ReactNode
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(props.prefilled)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === HASH) setOpen(true)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [])

  // Closing also drops the prefill and the hash, so a reload does not reopen it
  const close = () => {
    setOpen(false)
    if (window.location.hash === HASH || window.location.search) router.replace('/pipelines')
  }
  const onEscape = useEffectEvent(() => close())

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('input, textarea')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary inline-flex items-center gap-1.5"
      >
        <Plus size={15} aria-hidden /> Новый конвейер
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-[6vh] backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={props.title}
            className="glass glass--solid page-enter w-full max-w-4xl rounded-2xl p-5"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-text">{props.title}</h2>
                {props.hint && <p className="text-xs text-text-3">{props.hint}</p>}
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1.5 text-text-3 hover:bg-surface-2 hover:text-text"
                aria-label="Закрыть"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            {props.children}
          </div>
        </div>
      )}
    </>
  )
}
