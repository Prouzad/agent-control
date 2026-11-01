'use client'

import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export type SelectOption = { value: string; label: string; group?: string }

type Props = {
  options: SelectOption[]
  // Form field name; the value is posted through a hidden input
  name?: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  // Only needed when the select is not inside a <label>
  ariaLabel?: string
  size?: 'md' | 'sm'
  // bare: no box of its own, for selects that sit inside another control
  variant?: 'field' | 'bare'
  disabled?: boolean
  className?: string
}

type Place = { left: number; top: number; width: number; maxHeight: number; up: boolean }

const GAP = 6
const MAX_HEIGHT = 320

// A styled listbox in place of the browser's select: same keyboard behaviour, themed popup.
// The popup is portalled to <body> because cards use backdrop-filter, which would clip it
export const Select = (props: Props) => {
  const id = useId()
  const [inner, setInner] = useState(props.defaultValue ?? props.options[0]?.value ?? '')
  const value = props.value ?? inner
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<Place | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })

  const selectedIndex = Math.max(
    0,
    props.options.findIndex((o) => o.value === value),
  )
  const selected = props.options[selectedIndex]

  const measure = () => {
    const rect = button.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - GAP * 2
    const above = rect.top - GAP * 2
    const up = below < 200 && above > below
    setPlace({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 200) - 8)),
      top: up ? rect.top - GAP : rect.bottom + GAP,
      width: rect.width,
      maxHeight: Math.min(MAX_HEIGHT, up ? above : below),
      up,
    })
  }

  const show = () => {
    if (props.disabled) return
    measure()
    setActive(selectedIndex)
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = props.options[index]
    if (!option) return
    if (props.value === undefined) setInner(option.value)
    props.onChange?.(option.value)
    setOpen(false)
    button.current?.focus()
  }

  const follow = useEffectEvent(() => measure())

  // While open: follow scroll and resize, close on an outside press
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (button.current?.contains(target) || list.current?.contains(target)) return
      setOpen(false)
    }
    const onMove = () => follow()
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  // Keep the highlighted option in view
  useEffect(() => {
    if (!open) return
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = props.options.length - 1
    const keys: Record<string, () => void> = {
      ArrowDown: () => (open ? setActive((i) => Math.min(last, i + 1)) : show()),
      ArrowUp: () => (open ? setActive((i) => Math.max(0, i - 1)) : show()),
      Home: () => open && setActive(0),
      End: () => open && setActive(last),
      Enter: () => (open ? choose(active) : show()),
      ' ': () => (open ? choose(active) : show()),
      Escape: () => setOpen(false),
      Tab: () => setOpen(false),
    }
    const handler = keys[event.key]
    if (handler) {
      if (event.key !== 'Tab') event.preventDefault()
      handler()
      return
    }
    // Type-ahead: letters jump to the first option starting with what was typed
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      const now = Date.now()
      typed.current = {
        text: (now - typed.current.at < 700 ? typed.current.text : '') + event.key.toLowerCase(),
        at: now,
      }
      const match = props.options.findIndex((o) =>
        o.label
          .replace(/^[\s└]+/, '')
          .toLowerCase()
          .startsWith(typed.current.text),
      )
      if (match >= 0) {
        if (open) setActive(match)
        else choose(match)
      }
    }
  }

  const small = props.size === 'sm'
  const listId = `${id}-list`

  return (
    <>
      {props.name && <input type="hidden" name={props.name} value={value} />}
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={`flex w-full min-w-0 items-center gap-2 text-left text-text disabled:opacity-50 ${props.variant === 'bare' ? 'focus-visible:outline-none' : `rounded-md border border-border bg-bg transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:outline-none ${small ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm'}`} ${props.className ?? ''}`}
      >
        <span className="min-w-0 flex-1 truncate whitespace-pre">{selected?.label ?? '—'}</span>
        <ChevronDown
          size={small ? 13 : 15}
          className={`shrink-0 text-text-3 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            style={{
              left: place.left,
              top: place.up ? undefined : place.top,
              bottom: place.up ? window.innerHeight - place.top : undefined,
              minWidth: place.width,
              maxHeight: place.maxHeight,
            }}
            className="select-pop fixed z-50 max-w-[min(28rem,calc(100vw-16px))] overflow-auto rounded-xl border border-border-strong p-1 shadow-2xl"
          >
            {props.options.map((option, index) => {
              const header =
                option.group && option.group !== props.options[index - 1]?.group
                  ? option.group
                  : null
              const isSelected = option.value === value
              return (
                <li key={`${option.group ?? ''}${option.value}`} role="presentation">
                  {header && (
                    <div
                      className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-text-3 uppercase"
                      role="presentation"
                    >
                      {header}
                    </div>
                  )}
                  <div
                    id={`${id}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    onPointerEnter={() => setActive(index)}
                    onClick={() => choose(index)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm whitespace-pre ${index === active ? 'bg-accent-soft text-text' : 'text-text-2'}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected && <Check size={14} className="shrink-0 text-accent" aria-hidden />}
                  </div>
                </li>
              )
            })}
          </ul>,
          document.body,
        )}
    </>
  )
}
