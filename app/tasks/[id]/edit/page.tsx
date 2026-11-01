import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, PageHeader } from '@/components/ui'
import { getTask } from '@/server/tasks'
import { readView, visibleProjectOptions, visibleTeams } from '@/server/visibility'

import { editTaskAction } from '../../actions'
import { TaskForm } from '../../TaskForm'

const EditTaskPage = async (props: { params: Promise<{ id: string }> }) => {
  const { id } = await props.params
  const task = getTask(id)
  const view = await readView()
  // Pipeline stages are written by the pipeline, not by hand
  if (!task || task.pipelineId || !view.allowsProject(task.projectId)) notFound()
  const busy = task.status === 'running' || task.status === 'waiting'
  return (
    <>
      <Link
        href={`/tasks/${id}`}
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> К задаче
      </Link>
      <PageHeader
        title="Редактировать задачу"
        description={
          task.sessionId
            ? 'Агент уже работал над задачей: после сохранения следующий запуск начнётся с новой постановки'
            : 'Изменения применятся при следующем запуске'
        }
      />
      <Card className="max-w-4xl">
        {busy ? (
          <p className="text-sm text-text-2">
            Задача сейчас выполняется. Остановите её на странице задачи, затем редактируйте.
          </p>
        ) : (
          <TaskForm
            action={editTaskAction.bind(null, id)}
            submitLabel="Сохранить"
            projects={visibleProjectOptions(view)}
            teams={visibleTeams(view)}
            task={task}
          />
        )}
      </Card>
    </>
  )
}

export default EditTaskPage
