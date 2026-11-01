'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

const FADE = 'linear-gradient(to bottom, black calc(100% - 3rem), transparent)'

// Long text is cut to a few lines with a fade; a button opens the rest. The button only shows
// when the content really overflows, so short messages look as before
export const Collapsible = (props: { children: ReactNode; maxHeight?: number }) => {
  const maxHeight = props.maxHeight ?? 192
  const inner = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const element = inner.current
    if (!element) return
    const observer = new ResizeObserver(() => setOverflows(element.scrollHeight > maxHeight + 24))
    observer.observe(element)
    return () => observer.disconnect()
  }, [maxHeight])

  const clipped = overflows && !open
  return (
    <div>
      {/* A mask fades the cut edge into whatever background the text sits on */}
      <div className="overflow-hidden" style={clipped ? { maxHeight, maskImage: FADE } : undefined}>
        <div ref={inner}>{props.children}</div>
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          aria-expanded={open}
        >
          {open ? (
            <>
              <ChevronUp size={13} aria-hidden /> Свернуть
            </>
          ) : (
            <>
              <ChevronDown size={13} aria-hidden /> Показать полностью
            </>
          )}
        </button>
      )}
    </div>
  )
}
