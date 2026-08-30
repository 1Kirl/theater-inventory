import { describe, expect, it } from 'vitest'
import {
  EMPTY_PROFILE_INPUT, MAX_PROFILE_BIO, MAX_PROFILE_DISPLAY_NAME, PROFILE_FIELD_KEYS,
  effectiveDisplayName, profileFields, profileInputOf, teamNamesOf, validateProfile,
} from '@/domain/member-profile'
import type { OrganizationMembership, TheaterTeam } from '@/types/organization'

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

const TEAMS: TheaterTeam[] = [
  { team_id: 'team-sound', name: 'Sound' } as TheaterTeam,
  { team_id: 'team-lighting', name: 'Lighting' } as TheaterTeam,
  { team_id: 'team-scenic', name: 'Scenic' } as TheaterTeam,
]

describe('what somebody is called in one organization', () => {
  it('uses the override when they have set one', () => {
    expect(effectiveDisplayName(membership({ profile_display_name: 'Jina Kim' }), 'jina01'))
      .toBe('Jina Kim')
  })

  it('falls back to the account name when they have not', () => {
    // Derived, never copied. Copying the account name into every membership
    // would make a later change to it stop showing through.
    expect(effectiveDisplayName(membership(), 'Jina')).toBe('Jina')
    expect(effectiveDisplayName(null, 'Jina')).toBe('Jina')
  })

  it('treats a blank or whitespace override as no override', () => {
    expect(effectiveDisplayName(membership({ profile_display_name: '' }), 'Jina')).toBe('Jina')
    expect(effectiveDisplayName(membership({ profile_display_name: '   ' }), 'Jina')).toBe('Jina')
  })

  it('still says something when neither exists', () => {
    expect(effectiveDisplayName(membership(), null)).toBe('Unknown member')
    expect(effectiveDisplayName(membership(), '  ')).toBe('Unknown member')
  })

  it('gives the same person different names in different organizations', () => {
    // The whole reason this lives on the membership. A volunteer at one school
    // and a student at another are not obliged to present themselves alike.
    const atA = membership({ organization_id: 'org-a', profile_display_name: 'Jina Kim' })
    const atB = membership({ organization_id: 'org-b', profile_display_name: 'Jina' })

    expect(effectiveDisplayName(atA, 'jina01')).toBe('Jina Kim')
    expect(effectiveDisplayName(atB, 'jina01')).toBe('Jina')
  })
})

describe('reading a stored profile into a form', () => {
  it('starts from what is stored', () => {
    expect(profileInputOf(membership({
      profile_display_name: 'Jina Kim',
      profile_phone: '010-1234-5678',
      profile_contact_email: 'jina@school.edu',
      profile_bio: 'Sound crew.',
    }))).toEqual({
      displayName: 'Jina Kim', phone: '010-1234-5678',
      contactEmail: 'jina@school.edu', bio: 'Sound crew.',
    })
  })

  it('starts empty for a membership written before profiles existed', () => {
    expect(profileInputOf(membership())).toEqual(EMPTY_PROFILE_INPUT)
    expect(profileInputOf(null)).toEqual(EMPTY_PROFILE_INPUT)
  })
})

describe('what a profile is allowed to contain', () => {
  const ok = (input: Partial<typeof EMPTY_PROFILE_INPUT>) =>
    validateProfile({ ...EMPTY_PROFILE_INPUT, ...input })

  it('accepts a profile with nothing in it', () => {
    // Nobody is obliged to be reachable. A blank profile is a real answer, and
    // demanding a phone number to be listed would only produce fake ones.
    expect(ok({}).valid).toBe(true)
  })

  it('accepts phone numbers as people actually write them', () => {
    for (const phone of [
      '010-1234-5678', '+82 10 1234 5678', '(555) 123-4567', '555.123.4567', '5551234567',
    ]) {
      expect(ok({ phone }).valid, phone).toBe(true)
    }
  })

  it('refuses letters in a phone number', () => {
    expect(ok({ phone: 'call me' }).valid).toBe(false)
  })

  it('accepts an ordinary email and refuses a broken one', () => {
    expect(ok({ contactEmail: 'jina@school.edu' }).valid).toBe(true)
    expect(ok({ contactEmail: 'first.last@sub.school.ac.kr' }).valid).toBe(true)

    for (const bad of ['jina', 'jina@', '@school.edu', 'jina@school', 'a b@c.com']) {
      expect(ok({ contactEmail: bad }).valid, bad).toBe(false)
    }
  })

  it('trims what it keeps', () => {
    const result = ok({ displayName: '  Jina Kim  ', contactEmail: ' jina@school.edu ' })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.input.displayName).toBe('Jina Kim')
      expect(result.input.contactEmail).toBe('jina@school.edu')
    }
  })

  it('refuses text that is too long to belong on a card', () => {
    expect(ok({ displayName: 'a'.repeat(MAX_PROFILE_DISPLAY_NAME + 1) }).valid).toBe(false)
    expect(ok({ bio: 'a'.repeat(MAX_PROFILE_BIO + 1) }).valid).toBe(false)
    expect(ok({ bio: 'a'.repeat(MAX_PROFILE_BIO) }).valid).toBe(true)
  })

  it('refuses angle brackets, which have no place in a name or a bio', () => {
    expect(ok({ bio: 'I do <script>alert(1)</script>' }).valid).toBe(false)
    expect(ok({ displayName: '<b>Jina</b>' }).valid).toBe(false)
  })
})

describe('what a save actually writes', () => {
  it('writes only what was filled in', () => {
    expect(profileFields({
      displayName: 'Jina Kim', phone: '', contactEmail: 'jina@school.edu', bio: '',
    })).toEqual({
      profile_display_name: 'Jina Kim',
      profile_contact_email: 'jina@school.edu',
    })
  })

  it('writes nothing at all for an empty profile', () => {
    expect(profileFields(EMPTY_PROFILE_INPUT)).toEqual({})
  })

  it('removes a cleared field rather than storing an empty string', () => {
    // "Never said" and "cleared" become the same shape, so the interface has
    // one absent case to render instead of two.
    expect(profileFields({ ...EMPTY_PROFILE_INPUT, phone: '   ' })).toEqual({})
  })

  it('touches only the four fields a member owns', () => {
    const written = Object.keys(profileFields({
      displayName: 'a', phone: '1', contactEmail: 'a@b.co', bio: 'c',
    }))

    expect(written.sort()).toEqual([...PROFILE_FIELD_KEYS].sort())
    // Nothing about teams, permissions, activity, or identity can leave here.
    for (const forbidden of ['team_ids', 'permissions', 'is_active', 'uid', 'organization_id']) {
      expect(written).not.toContain(forbidden)
    }
  })
})

describe('which teams a member is on', () => {
  it('names them in the organization order, not the membership order', () => {
    expect(teamNamesOf(
      membership({ team_ids: ['team-scenic', 'team-sound'] }),
      TEAMS,
    )).toEqual(['Sound', 'Scenic'])
  })

  it('names nothing for somebody on no team', () => {
    expect(teamNamesOf(membership({ team_ids: [] }), TEAMS)).toEqual([])
  })

  it('ignores a team id the organization no longer has', () => {
    expect(teamNamesOf(membership({ team_ids: ['team-gone'] }), TEAMS)).toEqual([])
  })

  it('never returns a raw id', () => {
    const names = teamNamesOf(membership({ team_ids: ['team-sound'] }), TEAMS)
    expect(names).toEqual(['Sound'])
    expect(names.join()).not.toContain('team-')
  })
})
