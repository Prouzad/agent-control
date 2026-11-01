import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { imageLinks } from '@/lib/attachments'

import { DATA_DIR } from './db'

// Images pasted into a task's text live next to the database; the text links them by URL
const DIR = path.join(DATA_DIR, 'attachments')
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const
type Ext = keyof typeof TYPES
type MediaType = (typeof TYPES)[Ext]

const isExt = (value: string): value is Ext => Object.keys(TYPES).includes(value)
const extOf = (mediaType: string) =>
  Object.keys(TYPES)
    .filter(isExt)
    .find((ext) => TYPES[ext] === mediaType)

export const ATTACHMENT_URL = '/api/attachments/'
// Names are generated here, so anything else in a URL is not ours to serve
const NAME = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/

export const saveImage = (bytes: Buffer, mediaType: string) => {
  const ext = extOf(mediaType)
  if (!ext) throw new Error('Поддерживаются PNG, JPEG, GIF и WebP')
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Картинка больше 10 МБ')
  fs.mkdirSync(DIR, { recursive: true })
  const name = `${randomUUID()}.${ext}`
  fs.writeFileSync(path.join(DIR, name), bytes)
  return `${ATTACHMENT_URL}${name}`
}

export const readImage = (name: string): { bytes: Buffer; mediaType: MediaType } | null => {
  if (!NAME.test(name)) return null
  const ext = name.split('.').pop() ?? ''
  if (!isExt(ext)) return null
  try {
    return { bytes: fs.readFileSync(path.join(DIR, name)), mediaType: TYPES[ext] }
  } catch {
    return null
  }
}

// The images a text links to, in order and once each, as content blocks for the model
export const imageBlocks = (text: string) =>
  imageLinks(text).flatMap((url) => {
    const image = readImage(url.slice(ATTACHMENT_URL.length))
    return image
      ? [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: image.mediaType,
              data: image.bytes.toString('base64'),
            },
          },
        ]
      : []
  })
