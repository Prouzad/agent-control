'use client'

import { useEffect, useState } from 'react'

import { formatCompact, formatInt, formatPercent, formatUsd } from '@/lib/format'

const FORMATTERS = {
  usd: formatUsd,
  compact: formatCompact,
  // Counts never show fractions, even halfway through the run-up
  int: (value: number) => formatInt(Math.round(value)),
  percent: formatPercent,
}

type Props = { value: number; format: keyof typeof FORMATTERS; durationMs?: number }

// Numbers run up to their value on first render; reduced motion shows the value at once
export const CountUp = (props: Props) => {
  const [shown, setShown] = useState(props.value)

  useEffect(() => {
    // The server-rendered value stays put when motion is reduced
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const duration = props.durationMs ?? 900
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      setShown(props.value * eased)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [props.value, props.durationMs])

  return <span className="tabular">{FORMATTERS[props.format](shown)}</span>
}
