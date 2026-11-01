import { FilterBar } from '@/components/FilterBar'
import { SessionsTable } from '@/components/SessionsTable'
import { PageHeader } from '@/components/ui'
import { PERIODS, readScope, type SearchParams } from '@/lib/scope'
import { projectNames } from '@/server/projects'
import { visibleProjectOptions } from '@/server/visibility'
import { listSessions } from '@/server/queries'

const SessionsPage = async (props: { searchParams: SearchParams }) => {
  const { scope, period, project, view } = await readScope(props.searchParams)
  const sessions = listSessions(scope, 300)
  return (
    <>
      <PageHeader
        title="Сессии"
        description={`${sessions.length} сессий за период, свежие сверху`}
        actions={
          <FilterBar
            periods={[...PERIODS]}
            period={period}
            projects={visibleProjectOptions(view)}
            project={project}
          />
        }
      />
      <SessionsTable sessions={sessions} projectNames={projectNames()} />
    </>
  )
}

export default SessionsPage
