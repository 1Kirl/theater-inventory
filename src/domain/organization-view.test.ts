import { describe, expect, it } from 'vitest'
import { summarizeTeamNames, teamNamesFor } from '@/domain/organization-view'
import type { TheaterTeam } from '@/types/organization'

function team(teamId: string, name: string): TheaterTeam {
  return {
    team_id: teamId,
    organization_id: 'org-1',
    name,
  } as TheaterTeam
}

const teams = [team('t-lighting', 'Lighting'), team('t-sound', 'Sound'), team('t-props', 'Props')]

describe('teamNamesFor', () => {
  it('resolves assigned IDs to names', () => {
    expect(teamNamesFor({ team_ids: ['t-sound', 't-lighting'] }, teams)).toEqual([
      'Lighting',
      'Sound',
    ])
  })

  it('follows the order of the team list, not the membership', () => {
    expect(teamNamesFor({ team_ids: ['t-props', 't-lighting'] }, teams)).toEqual([
      'Lighting',
      'Props',
    ])
  })

  it('returns nothing for an unassigned membership', () => {
    expect(teamNamesFor({ team_ids: [] }, teams)).toEqual([])
  })

  it('returns nothing when there is no membership', () => {
    expect(teamNamesFor(null, teams)).toEqual([])
  })

  it('drops IDs with no matching team rather than showing a raw ID', () => {
    expect(teamNamesFor({ team_ids: ['t-lighting', 't-deleted'] }, teams)).toEqual(['Lighting'])
  })

  it('returns nothing when no teams are loaded', () => {
    expect(teamNamesFor({ team_ids: ['t-lighting'] }, [])).toEqual([])
  })
})

describe('summarizeTeamNames', () => {
  it('explains an empty assignment', () => {
    expect(summarizeTeamNames([])).toBe('No teams assigned')
  })

  it('joins a short list', () => {
    expect(summarizeTeamNames(['Lighting', 'Sound'])).toBe('Lighting, Sound')
  })

  it('shows every name at the limit', () => {
    expect(summarizeTeamNames(['Lighting', 'Sound', 'Props'])).toBe('Lighting, Sound, Props')
  })

  it('summarizes the overflow', () => {
    expect(summarizeTeamNames(['Lighting', 'Sound', 'Props', 'Costume', 'Scenic'])).toBe(
      'Lighting, Sound, Props and 2 more',
    )
  })

  it('uses a singular tail for one extra', () => {
    expect(summarizeTeamNames(['Lighting', 'Sound', 'Props', 'Costume'])).toBe(
      'Lighting, Sound, Props and 1 more',
    )
  })

  it('respects a custom limit', () => {
    expect(summarizeTeamNames(['Lighting', 'Sound', 'Props'], 1)).toBe('Lighting and 2 more')
  })
})
