// Pasted images sit in task text as Markdown: ![Картинка](/api/attachments/<uuid>.<ext>)
export const IMAGE_MARKDOWN =
  /!\[[^\]]*\]\((\/api\/attachments\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp))\)/g

export const imageLinks = (text: string) => [
  ...new Set([...text.matchAll(IMAGE_MARKDOWN)].flatMap((m) => (m[1] ? [m[1]] : []))),
]
