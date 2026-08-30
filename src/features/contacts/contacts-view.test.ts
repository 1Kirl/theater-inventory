import { describe, expect, it } from 'vitest'
import {
  ALL_TEAMS, buildContactRows, emptyStateOf, filterContacts, matchesSearch, matchesTeam,
  resolveTeamFilter,
} from '@/features/contacts/contacts-view'
import type { OrganizationMembership, TheaterTeam } from '@/types/organization'
import type { UserProfile } from '@/types/user'

const TEAMS: TheaterTeam[] = [
  { team_id: 'team-sound', name: 'Sound' } as TheaterTeam,
  { team_id: 'team-lighting', name: 'Lighting' } as TheaterTeam,
  { team_id: 'team-scenic', name: 'Scenic' } as TheaterTeam,
]

function membership(overrides: Partial<OrganizationMembership> = {}): OrganizationMembership {
  return {
    organization_id: 'org-a',
    uid: 'uid-1',
    team_ids: ['team-sound'],
    permissions: { inventory: 'view', maintenance: 'none', productions: 'none', calendar: 'none' },
    is_active: true,
    ...overrides,
  } as OrganizationMembership
}

const PROFILES = new Map<string, UserProfile>([
  ['uid-1', { uid: 'uid-1', display_name: 'Jina' } as UserProfile],
  ['uid-2', { uid: 'uid-2', display_name: 'Minsu' } as UserProfile],
  ['uid-3', { uid: 'uid-3', display_name: 'Alex' } as UserProfile],
])

const rows = (memberships: OrganizationMembership[]) =>
  buildContactRows({ memberships, teams: TEAMS, profiles: PROFILES })

describe('building the directory', () => {
  it('shows the override where there is one and the account name otherwise', () => {
    const built = rows([
      membership({ uid: 'uid-1', profile_display_name: 'Jina Kim' }),
      membership({ uid: 'uid-2' }),
    ])

    expect(built.map((row) => row.name)).toEqual(['Jina Kim', 'Minsu'])
  })

  it('sorts by the name people actually see', () => {
    const built = rows([
      membership({ uid: 'uid-2' }),
      membership({ uid: 'uid-3' }),
      membership({ uid: 'uid-1' }),
    ])

    expect(built.map((row) => row.name)).toEqual(['Alex', 'Jina', 'Minsu'])
  })

  it('leaves out a membership that was deactivated', () => {
    // Deactivated is how this product removes somebody. They should not still
    // be listed as a person to contact.
    expect(rows([membership({ uid: 'uid-1', is_active: false })])).toEqual([])
  })

  it('names teams rather than ids', () => {
    const built = rows([membership({ team_ids: ['team-sound', 'team-scenic'] })])

    expect(built[0]?.teamNames).toEqual(['Sound', 'Scenic'])
    expect(JSON.stringify(built[0]?.teamNames)).not.toContain('team-')
  })

  it('reports what nobody filled in as absent, not as empty text', () => {
    const built = rows([membership()])

    expect(built[0]?.phone).toBeNull()
    expect(built[0]?.email).toBeNull()
    expect(built[0]?.bio).toBeNull()
  })

  it('reports a whitespace-only field as absent too', () => {
    const built = rows([membership({ profile_phone: '   ', profile_bio: '  ' })])

    expect(built[0]?.phone).toBeNull()
    expect(built[0]?.bio).toBeNull()
  })

  it('carries nothing the directory has no business showing', () => {
    const built = rows([membership({ profile_phone: '010-1234-5678' })])
    const shown = JSON.stringify(built)

    // Permissions, activity, and timestamps are administration, not contact
    // details. The synthetic address never existed here to begin with.
    expect(shown).not.toContain('permissions')
    expect(shown).not.toContain('is_active')
    expect(shown).not.toContain('theater-inventory.example.com')
  })
})

describe('searching', () => {
  const directory = rows([
    membership({ uid: 'uid-1', profile_display_name: 'Jina Kim', profile_contact_email: 'jina@school.edu' }),
    membership({ uid: 'uid-2', team_ids: ['team-lighting'] }),
    membership({ uid: 'uid-3', team_ids: ['team-scenic'] }),
  ])

  const found = (search: string) =>
    directory.filter((row) => matchesSearch(row, search)).map((row) => row.name)

  it('matches a name', () => {
    expect(found('kim')).toEqual(['Jina Kim'])
    expect(found('Jina')).toEqual(['Jina Kim'])
  })

  it('ignores case and surrounding spaces', () => {
    expect(found('  JINA  ')).toEqual(['Jina Kim'])
  })

  it('matches a team name, so typing a crew works', () => {
    expect(found('lighting')).toEqual(['Minsu'])
  })

  it('matches a contact address', () => {
    expect(found('school.edu')).toEqual(['Jina Kim'])
  })

  it('shows everyone when nothing is typed', () => {
    expect(found('')).toHaveLength(3)
    expect(found('   ')).toHaveLength(3)
  })

  it('does not search a phone number or a biography', () => {
    // Matching a fragment of somebody's number is not something anybody wants,
    // and matching prose produces results nobody can explain.
    const withDetails = rows([
      membership({ uid: 'uid-1', profile_phone: '010-9999-0000', profile_bio: 'wireless microphones' }),
    ])

    expect(matchesSearch(withDetails[0]!, '9999')).toBe(false)
    expect(matchesSearch(withDetails[0]!, 'wireless')).toBe(false)
  })
})

describe('filtering by team', () => {
  const directory = rows([
    membership({ uid: 'uid-1', team_ids: ['team-sound'] }),
    membership({ uid: 'uid-2', team_ids: ['team-sound', 'team-lighting'] }),
    membership({ uid: 'uid-3', team_ids: [] }),
  ])

  const inTeam = (teamId: string) =>
    directory.filter((row) => matchesTeam(row, teamId)).map((row) => row.name)

  it('shows everybody under All, including somebody on no team', () => {
    expect(inTeam(ALL_TEAMS)).toEqual(['Alex', 'Jina', 'Minsu'])
  })

  it('shows only the members of the chosen team', () => {
    expect(inTeam('team-sound')).toEqual(['Jina', 'Minsu'])
    expect(inTeam('team-lighting')).toEqual(['Minsu'])
  })

  it('shows somebody on two teams under each of them', () => {
    expect(inTeam('team-sound')).toContain('Minsu')
    expect(inTeam('team-lighting')).toContain('Minsu')
  })

  it('shows them only once under All', () => {
    // The row is the person, not their membership of a team.
    expect(inTeam(ALL_TEAMS).filter((name) => name === 'Minsu')).toHaveLength(1)
  })

  it('shows nobody for a team nobody is on', () => {
    expect(inTeam('team-scenic')).toEqual([])
  })
})

describe('searching and filtering together', () => {
  const directory = rows([
    membership({ uid: 'uid-1', profile_display_name: 'Jina Kim', team_ids: ['team-sound'] }),
    membership({ uid: 'uid-2', profile_display_name: 'Minsu Kim', team_ids: ['team-lighting'] }),
    membership({ uid: 'uid-3', profile_display_name: 'Alex Park', team_ids: ['team-sound'] }),
  ])

  it('requires both, not either', () => {
    expect(filterContacts(directory, { search: 'Kim', teamId: 'team-sound' })
      .map((row) => row.name)).toEqual(['Jina Kim'])
  })

  it('narrows to the team when nothing is typed', () => {
    expect(filterContacts(directory, { search: '', teamId: 'team-sound' })
      .map((row) => row.name)).toEqual(['Alex Park', 'Jina Kim'])
  })

  it('narrows to the search when the team is All', () => {
    expect(filterContacts(directory, { search: 'Kim', teamId: ALL_TEAMS })
      .map((row) => row.name)).toEqual(['Jina Kim', 'Minsu Kim'])
  })

  it('finds nobody when the two disagree', () => {
    expect(filterContacts(directory, { search: 'Park', teamId: 'team-lighting' })).toEqual([])
  })
})

describe('switching organization', () => {
  it('keeps a team the new organization also has', () => {
    expect(resolveTeamFilter('team-sound', TEAMS)).toBe('team-sound')
  })

  it('falls back to All for a team the new organization does not have', () => {
    // Otherwise the directory comes back empty for a reason nobody can see.
    expect(resolveTeamFilter('team-from-another-org', TEAMS)).toBe(ALL_TEAMS)
  })

  it('leaves All alone', () => {
    expect(resolveTeamFilter(ALL_TEAMS, TEAMS)).toBe(ALL_TEAMS)
    expect(resolveTeamFilter(ALL_TEAMS, [])).toBe(ALL_TEAMS)
  })

  it('falls back when the new organization has no teams at all', () => {
    expect(resolveTeamFilter('team-sound', [])).toBe(ALL_TEAMS)
  })
})

describe('an empty screen', () => {
  it('distinguishes an empty organization from an unlucky search', () => {
    // Telling somebody the organization is empty when their search simply
    // matched nothing sends them looking for a problem that is not there.
    expect(emptyStateOf({ total: 0, visible: 0 })).toBe('no-members')
    expect(emptyStateOf({ total: 8, visible: 0 })).toBe('no-matches')
    expect(emptyStateOf({ total: 8, visible: 3 })).toBe('none')
  })
})
