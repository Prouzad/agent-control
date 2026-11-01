import { getPipeline, getStageById } from '@/server/pipelines'
import { readView } from '@/server/visibility'

export const dynamic = 'force-dynamic'

// One stage's result, asked for when someone opens it on the pipeline page
export const GET = async (request: Request) => {
  const stage = getStageById(new URL(request.url).searchParams.get('id') ?? '')
  const pipeline = stage ? getPipeline(stage.pipelineId) : undefined
  if (!stage || !pipeline || !(await readView()).allowsProject(pipeline.projectId))
    return Response.json({ error: 'Не найдено' }, { status: 404 })
  return Response.json({ output: stage.output ?? '' })
}
