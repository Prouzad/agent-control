import type { ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { IMAGE_MARKDOWN } from '@/lib/attachments'

// Agent reports are Markdown: render them in the dashboard's own type, tables included
const COMPONENTS: Components = {
  h1: (props) => (
    <h3 className="mt-4 mb-2 text-base font-semibold text-text first:mt-0">{props.children}</h3>
  ),
  h2: (props) => (
    <h4 className="mt-4 mb-1.5 text-sm font-semibold text-text first:mt-0">{props.children}</h4>
  ),
  h3: (props) => (
    <h5 className="mt-3 mb-1 text-sm font-medium text-text first:mt-0">{props.children}</h5>
  ),
  h4: (props) => (
    <h6 className="mt-3 mb-1 text-sm font-medium text-text-2 first:mt-0">{props.children}</h6>
  ),
  p: (props) => <p className="my-1.5 leading-relaxed">{props.children}</p>,
  ul: (props) => (
    <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-text-3">{props.children}</ul>
  ),
  ol: (props) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-text-3">{props.children}</ol>
  ),
  li: (props) => <li className="leading-relaxed">{props.children}</li>,
  strong: (props) => <strong className="font-semibold text-text">{props.children}</strong>,
  a: (props) => (
    <a href={props.href} className="text-accent hover:underline" target="_blank" rel="noreferrer">
      {props.children}
    </a>
  ),
  blockquote: (props) => (
    <blockquote className="my-2 border-l-2 border-accent pl-3 text-text-2">
      {props.children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  img: (props) =>
    typeof props.src === 'string' ? <TaskImage src={props.src} alt={props.alt ?? ''} /> : null,
  code: (props) => (
    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-text">
      {props.children}
    </code>
  ),
  pre: (props) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-surface-2 p-2.5 font-mono text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0">
      {props.children}
    </pre>
  ),
  table: (props) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[480px] text-left text-xs">{props.children}</table>
    </div>
  ),
  thead: (props) => <thead className="bg-surface-2 text-text-2">{props.children}</thead>,
  th: (props) => <th className="px-2.5 py-1.5 font-medium">{props.children}</th>,
  td: (props) => (
    <td className="border-t border-border px-2.5 py-1.5 align-top">{props.children}</td>
  ),
}

// Full size opens in a new tab
const TaskImage = (props: { src: string; alt: string }) => (
  <a href={props.src} target="_blank" rel="noreferrer" className="my-2 block w-fit">
    {/* eslint-disable-next-line @next/next/no-img-element -- local files served by our own route */}
    <img
      src={props.src}
      alt={props.alt || 'Картинка'}
      className="max-h-80 max-w-full rounded-md border border-border hover:border-accent"
    />
  </a>
)

// A task's own text: kept as typed, with pasted images shown in place
export const TaskText = (props: { text: string }) => {
  const parts = props.text.split(new RegExp(IMAGE_MARKDOWN.source))
  return (
    <div className="text-sm whitespace-pre-wrap text-text-2">
      {parts.map((part, index) =>
        index % 2 ? (
          <TaskImage key={index} src={part} alt="" />
        ) : (
          part.trim() && <span key={index}>{part.replace(/^\n+|\n+$/g, '')}</span>
        ),
      )}
    </div>
  )
}

export const Markdown = (props: { children: string; className?: string }) => (
  <div className={`text-sm text-text-2 ${props.className ?? ''}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {props.children}
    </ReactMarkdown>
  </div>
)

// The short part of a report («Коротко») stays in view; the full analysis («Подробно») folds away
const SHORT = /^#{1,3}\s*Коротко\s*$/im
const DETAILS = /^#{1,3}\s*Подробно\s*$/im

export const Report = (props: { text: string; detailsLabel?: ReactNode }) => {
  const split = props.text.search(DETAILS)
  if (!SHORT.test(props.text) || split < 0) return <Markdown>{props.text}</Markdown>
  const short = props.text.slice(0, split).replace(SHORT, '').trim()
  const details = props.text.slice(split).replace(DETAILS, '').trim()
  return (
    <div>
      <div className="rounded-md border border-accent/30 bg-accent-soft p-3">
        <Markdown>{short}</Markdown>
      </div>
      {details && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-text-3 hover:text-text-2">
            {props.detailsLabel ?? 'Подробности'}
          </summary>
          <Markdown className="mt-2">{details}</Markdown>
        </details>
      )}
    </div>
  )
}
