import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { Card, PageHeader } from '@/components/ui'
import type { SearchParams } from '@/lib/scope'
import { readView, visibleTeams } from '@/server/visibility'

import { createRoleAction } from '../actions'
import { RoleForm } from '../RoleForm'

const NewRolePage = async (props: { searchParams: SearchParams }) => {
  const params = await props.searchParams
  const teams = visibleTeams(await readView())
  const teamId = typeof params['team'] === 'string' ? params['team'] : teams[0]?.id
  return (
    <>
      <Link
        href="/agents"
        className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-text"
      >
        <ArrowLeft size={14} aria-hidden /> Агенты
      </Link>
      <PageHeader
        title="Новая роль"
        description="Агент со своей зоной ответственности, моделью и инструментами"
      />
      <Card className="max-w-3xl">
        <RoleForm
          action={createRoleAction}
          teams={teams}
          defaultTeamId={teamId}
          submitLabel="Создать роль"
        />
      </Card>
    </>
  )
}

export default NewRolePage
