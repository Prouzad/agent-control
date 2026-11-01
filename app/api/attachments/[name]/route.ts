import { readImage } from '@/server/attachments'

export const GET = async (_request: Request, context: { params: Promise<{ name: string }> }) => {
  const image = readImage((await context.params).name)
  if (!image) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'content-type': image.mediaType,
      // Names are random and files never change
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}
