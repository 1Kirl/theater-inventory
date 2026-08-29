import { describe, expect, it } from 'vitest'
import { membersOfTeam, type TeamMemberOption } from '@/features/inventory/useTeamMembers'

const MEMBERS: TeamMemberOption[] = [
  { uid: 'a', displayName: 'Ana', teamIds: ['team-sound'] },
  { uid: 'b', displayName: 'Ben', teamIds: ['team-sound', 'team-lighting'] },
  { uid: 'c', displayName: 'Cal', teamIds: ['team-lighting'] },
  { uid: 'd', displayName: 'Dee', teamIds: [] },
]

describe('who a unit can be checked out to', () => {
  it('offers only people on the borrowing crew', () => {
    expect(membersOfTeam(MEMBERS, 'team-sound').map((m) => m.uid)).toEqual(['a', 'b'])
    expect(membersOfTeam(MEMBERS, 'team-lighting').map((m) => m.uid)).toEqual(['b', 'c'])
  })

  it('offers nobody until a team is chosen', () => {
    // The list is meaningless before then, and showing everyone would invite
    // picking somebody who is not on the crew taking the equipment.
    expect(membersOfTeam(MEMBERS, null)).toEqual([])
    expect(membersOfTeam(MEMBERS, '')).toEqual([])
  })

  it('offers nobody for a team no one is on', () => {
    expect(membersOfTeam(MEMBERS, 'team-costume')).toEqual([])
  })

  it('leaves out someone on no team at all', () => {
    expect(membersOfTeam(MEMBERS, 'team-sound').map((m) => m.uid)).not.toContain('d')
  })
})
