import { worktreeDiff } from '@/server/git'
import { getPipeline } from '@/server/pipelines'
import { getTask } from '@/server/tasks'
import { readView } from '@/server/visibility'

export const dynamic = 'force-dynamic'

// The full patch of a task's or a pipeline's checkout, asked for when someone opens it
export const GET = async (request: Request) => {
  const params = new URL(request.url).searchParams
  const taskId = params.get('task')
  const pipelineId = params.get('pipeline')
  const source = taskId ? getTask(taskId) : pipelineId ? getPipeline(pipelineId) : undefined
  if (!source || !(await readView()).allowsProject(source.projectId))
    return Response.json({ error: 'Не найдено' }, { status: 404 })
  if (!source.worktreePath || !source.baseCommit)
    return Response.json({ patch: '', truncated: false })
  try {
    const diff = await worktreeDiff(source.worktreePath, source.baseCommit)
    return Response.json({ patch: diff.patch, truncated: diff.truncated })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
