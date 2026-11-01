'use client'

import { Send } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'

import { ImageTextarea } from '@/components/ImageTextarea'

import { sayToPipelineAction } from '../actions'

// The field starts empty after each send; ⌘/Ctrl+Enter sends
export const ChatForm = (props: { pipelineId: string; hint: string }) => {
  const [round, setRound] = useState(0)

  const send = async (form: FormData) => {
    await sayToPipelineAction(props.pipelineId, form)
    setRound((n) => n + 1)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.currentTarget.requestSubmit()
    }
  }

  return (
    <form action={send} onKeyDown={onKeyDown} className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <ImageTextarea
          key={round}
          name="text"
          rows={2}
          placeholder={`${props.hint} ⌘↵ — отправить`}
          className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm"
        />
      </div>
      <button type="submit" className="btn-primary shrink-0" aria-label="Отправить">
        <Send size={14} aria-hidden />
      </button>
    </form>
  )
}
