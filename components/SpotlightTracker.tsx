'use client'

import { useEffect } from 'react'

// One listener for the whole app: the .glass panel under the cursor gets --mx/--my for its spotlight
export const SpotlightTracker = () => {
  useEffect(() => {
    let frame = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const target = event.target instanceof Element ? event.target.closest('.glass') : null
        if (!(target instanceof HTMLElement)) return
        const rect = target.getBoundingClientRect()
        target.style.setProperty('--mx', `${event.clientX - rect.left}px`)
        target.style.setProperty('--my', `${event.clientY - rect.top}px`)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])
  return null
}
