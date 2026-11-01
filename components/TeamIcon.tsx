import { Users } from 'lucide-react'

import { TEAM_ICONS } from '@/lib/teams'

export const TeamIcon = (props: { teamId: string; size?: number }) => {
  const Icon = TEAM_ICONS[props.teamId] ?? Users
  return <Icon size={props.size ?? 18} aria-hidden />
}
