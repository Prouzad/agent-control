import { Archive, ArchiveRestore, Pin, PinOff, Plus, Trash2 } from 'lucide-react'

import { Select } from '@/components/Select'
import { Card, Empty, PageHeader } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { listLessons, type Lesson } from '@/server/lessons'
import { listRoles } from '@/server/org'
import { effectiveTeamIds, flattenTree, projectTree } from '@/server/projects'
import { readView } from '@/server/visibility'

import {
  addLessonAction,
  archiveLessonAction,
  deleteLessonAction,
  pinLessonAction,
  saveLessonAction,
} from './actions'

const field = 'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm'
const icon = 'rounded-md p-1.5 text-text-3 hover:bg-surface-2 hover:text-text'

type RoleOption = { value: string; label: string }

const LessonRow = (props: { lesson: Lesson; roles: RoleOption[] }) => {
  const l = props.lesson
  return (
    <li
      className={`flex flex-col gap-2 border-t border-border py-3 first:border-t-0 ${l.archived ? 'opacity-60' : ''}`}
    >
      <form action={saveLessonAction.bind(null, l.id)} className="flex flex-col gap-2">
        <textarea name="text" defaultValue={l.text} rows={2} className={field} aria-label="Урок" />
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
          <div className="w-56">
            <Select
              name="roleId"
              size="sm"
              defaultValue={l.roleId ?? ''}
              options={props.roles}
              ariaLabel="Для кого"
            />
          </div>
          <span>
            {l.source ?? '—'} · {formatDateTime(l.updatedAt)}
            {l.pinned ? ' · закреплён' : ''}
          </span>
          <button
            type="submit"
            className="ml-auto rounded-md border border-border px-2.5 py-1 text-text-2 hover:text-text"
          >
            Сохранить
          </button>
        </div>
      </form>
      <div className="flex gap-1 self-end">
        <form action={pinLessonAction.bind(null, l.id, !l.pinned)}>
          <button
            type="submit"
            className={icon}
            aria-label={l.pinned ? 'Открепить' : 'Закрепить'}
            title={l.pinned ? 'Открепить' : 'Закрепить: всегда в промпте, не уходит в архив'}
          >
            {l.pinned ? <PinOff size={15} aria-hidden /> : <Pin size={15} aria-hidden />}
          </button>
        </form>
        <form action={archiveLessonAction.bind(null, l.id, !l.archived)}>
          <button
            type="submit"
            className={icon}
            aria-label={l.archived ? 'Вернуть' : 'В архив'}
            title={l.archived ? 'Вернуть агентам' : 'В архив: агенты его не получают'}
          >
            {l.archived ? (
              <ArchiveRestore size={15} aria-hidden />
            ) : (
              <Archive size={15} aria-hidden />
            )}
          </button>
        </form>
        <form action={deleteLessonAction.bind(null, l.id)}>
          <button
            type="submit"
            className={`${icon} hover:text-critical`}
            aria-label="Удалить"
            title="Удалить"
          >
            <Trash2 size={15} aria-hidden />
          </button>
        </form>
      </div>
    </li>
  )
}

const LessonsPage = async () => {
  const view = await readView()
  const projects = flattenTree(projectTree()).filter((p) => view.allowsProject(p.id))
  const roles = listRoles()
  const all = listLessons()

  // Projects with lessons or with their own teams: those are the ones agents work in
  const shown = projects.filter(
    (p) => all.some((l) => l.projectId === p.id) || effectiveTeamIds(p.id).length > 0,
  )

  return (
    <>
      <PageHeader
        title="Уроки"
        description="Правила из прошлых ошибок агентов: после каждого конвейера их выводит модель из возвратов на доработку, ваших поправок и отказов. Агент получает уроки своего проекта и роли в начале работы — закреплённые всегда, остальные свежие в пределах ~1500 токенов."
      />
      {shown.length === 0 && <Empty>Пока нет проектов с командами</Empty>}
      <div className="flex flex-col gap-4">
        {shown.map((project) => {
          const teamIds = effectiveTeamIds(project.id)
          const roleOptions: RoleOption[] = [
            { value: '', label: 'Для всех ролей' },
            ...roles
              .filter((r) => teamIds.includes(r.teamId))
              .map((r) => ({ value: r.id, label: r.title })),
          ]
          const lessons = all.filter((l) => l.projectId === project.id)
          const active = lessons.filter((l) => !l.archived)
          const archived = lessons.filter((l) => l.archived)
          return (
            <Card
              key={project.id}
              title={project.name}
              hint={`${active.length} действующих${archived.length ? ` · ${archived.length} в архиве` : ''}`}
            >
              {active.length > 0 ? (
                <ul>
                  {active.map((lesson) => (
                    <LessonRow key={lesson.id} lesson={lesson} roles={roleOptions} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-3">
                  Уроков пока нет: они появятся после первого конвейера с ошибками или поправками.
                </p>
              )}
              <form
                action={addLessonAction.bind(null, project.id)}
                className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
              >
                <textarea
                  name="text"
                  rows={2}
                  required
                  placeholder="Своё правило для агентов этого проекта"
                  className={field}
                  aria-label="Новый урок"
                />
                <div className="flex items-center gap-2">
                  <div className="w-56">
                    <Select
                      name="roleId"
                      size="sm"
                      defaultValue=""
                      options={roleOptions}
                      ariaLabel="Для кого"
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn-primary ml-auto inline-flex items-center gap-1.5"
                  >
                    <Plus size={14} aria-hidden /> Добавить
                  </button>
                </div>
              </form>
              {archived.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-text-3 hover:text-text-2">
                    Архив
                  </summary>
                  <ul>
                    {archived.map((lesson) => (
                      <LessonRow key={lesson.id} lesson={lesson} roles={roleOptions} />
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}

export default LessonsPage
