import { MAX_IMAGE_BYTES, saveImage } from '@/server/attachments'

export const dynamic = 'force-dynamic'

// A pasted or dropped image: the body is the raw file, its type in Content-Type
export const POST = async (request: Request) => {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_IMAGE_BYTES)
    return Response.json({ error: 'Картинка больше 10 МБ' }, { status: 413 })
  try {
    const bytes = Buffer.from(await request.arrayBuffer())
    const url = saveImage(bytes, request.headers.get('content-type') ?? '')
    return Response.json({ url })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    )
  }
}
