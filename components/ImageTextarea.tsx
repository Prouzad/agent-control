'use client'

import { ImagePlus, Loader2, X } from 'lucide-react'
import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'

import { obj, str } from '@/lib/json'
import { imageLinks } from '@/lib/attachments'

type Props = {
  name: string
  rows: number
  defaultValue?: string
  className?: string
  placeholder?: string
}

const upload = async (file: File) => {
  const response = await fetch('/api/attachments', {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  })
  const body = obj(await response.json().catch(() => null))
  const url = str(body?.['url'])
  if (!response.ok || !url) throw new Error(str(body?.['error']) ?? 'Не удалось сохранить картинку')
  return url
}

// A textarea that takes images straight from the clipboard or a drop: each one is saved and
// linked in the text as Markdown, which both the page and the agent understand
export const ImageTextarea = (props: Props) => {
  const [text, setText] = useState(props.defaultValue ?? '')
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  const insert = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    const start = area.current?.selectionStart ?? text.length
    const end = area.current?.selectionEnd ?? start
    setError(null)
    setPending((n) => n + images.length)
    try {
      const urls = await Promise.all(images.map(upload))
      const snippet = urls.map((url) => `\n![Картинка](${url})\n`).join('')
      setText((current) => current.slice(0, start) + snippet + current.slice(end))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPending((n) => n - images.length)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files]
    if (!files.some((f) => f.type.startsWith('image/'))) return
    event.preventDefault()
    void insert(files)
  }

  const onDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    const files = [...event.dataTransfer.files]
    if (!files.some((f) => f.type.startsWith('image/'))) return
    event.preventDefault()
    void insert(files)
  }

  const remove = (url: string) =>
    setText((current) =>
      current.replace(
        new RegExp(`\\n?!\\[[^\\]]*\\]\\(${url.replaceAll('.', '\\.')}\\)\\n?`),
        '\n',
      ),
    )

  const images = imageLinks(text)

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={area}
        name={props.name}
        rows={props.rows}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={onPaste}
        onDrop={onDrop}
        placeholder={props.placeholder}
        className={props.className}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
        {pending > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-accent">
            <Loader2 size={13} className="animate-spin" aria-hidden />
            Сохраняю картинку…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <ImagePlus size={13} aria-hidden />
            Картинку можно вставить сюда: скопируйте и нажмите ⌘V или перетащите — агент её увидит
          </span>
        )}
        {error && <span className="text-critical">{error}</span>}
      </div>
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Картинки в описании">
          {images.map((url) => (
            <li key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local files served by our own route */}
              <img
                src={url}
                alt="Картинка из описания"
                className="h-20 w-auto max-w-40 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => remove(url)}
                className="absolute -top-1.5 -right-1.5 rounded-full border border-border bg-surface-solid p-0.5 text-text-2 hover:text-critical"
                aria-label="Убрать картинку"
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
