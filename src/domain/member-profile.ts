import type { OrganizationMembership, TheaterTeam } from '@/types/organization'

/**
 * How a person appears inside one organization.
 *
 * The account has one display name; a membership may override it, and may carry
 * a phone number, a contact address, and a line about what they do. All of it
 * belongs to the member, and all of it belongs to *that membership* — the same
 * account in another organization has a separate set, and nothing is shared
 * between them.
 *
 * The address here is one the member typed. The synthetic address the product
 * authenticates with is an internal identifier and never appears anywhere a
 * person can see, including here.
 */

export const MAX_PROFILE_DISPLAY_NAME = 60
export const MAX_PROFILE_PHONE = 40
export const MAX_PROFILE_EMAIL = 254
export const MAX_PROFILE_BIO = 300

export interface MemberProfileInput {
  displayName: string
  phone: string
  contactEmail: string
  bio: string
}

export const EMPTY_PROFILE_INPUT: MemberProfileInput = {
  displayName: '', phone: '', contactEmail: '', bio: '',
}

/** The stored profile, as a form starts from it. */
export function profileInputOf(
  membership: Pick<OrganizationMembership,
    'profile_display_name' | 'profile_phone' | 'profile_contact_email' | 'profile_bio'> | null,
): MemberProfileInput {
  return {
    displayName: membership?.profile_display_name ?? '',
    phone: membership?.profile_phone ?? '',
    contactEmail: membership?.profile_contact_email ?? '',
    bio: membership?.profile_bio ?? '',
  }
}

/**
 * What this person is called here.
 *
 * The override wins when it says something; otherwise the account's name shows
 * through. Deriving it rather than copying the account name into every
 * membership means changing the account name still works, and means an empty
 * override is a real state rather than a stale copy.
 */
export function effectiveDisplayName(
  membership: Pick<OrganizationMembership, 'profile_display_name'> | null,
  accountDisplayName: string | null | undefined,
): string {
  const override = membership?.profile_display_name?.trim() ?? ''
  if (override.length > 0) return override

  const account = accountDisplayName?.trim() ?? ''
  return account.length > 0 ? account : 'Unknown member'
}

export type ProfileValidation =
  | { valid: true; input: MemberProfileInput }
  | { valid: false; message: string }

/**
 * Nothing here is required.
 *
 * A member who fills in none of it still appears in the directory under their
 * account name, which is the point — a blank profile is not a broken one, and
 * demanding a phone number to be listed would just produce fake ones.
 */
export function validateProfile(input: MemberProfileInput): ProfileValidation {
  const displayName = input.displayName.trim()
  const phone = input.phone.trim()
  const contactEmail = input.contactEmail.trim()
  const bio = input.bio.trim()

  if (displayName.length > MAX_PROFILE_DISPLAY_NAME) {
    return { valid: false, message: `Name must be ${MAX_PROFILE_DISPLAY_NAME} characters or fewer.` }
  }
  if (phone.length > MAX_PROFILE_PHONE) {
    return { valid: false, message: `Phone must be ${MAX_PROFILE_PHONE} characters or fewer.` }
  }
  // Deliberately not a format check. Numbers are written differently in every
  // country and every school, and refusing an unfamiliar shape would be wrong
  // more often than it would be right.
  if (phone.length > 0 && !/^[0-9+()\-.\s]+$/.test(phone)) {
    return { valid: false, message: 'Phone can contain digits and + - ( ) . and spaces.' }
  }
  if (contactEmail.length > MAX_PROFILE_EMAIL) {
    return { valid: false, message: `Email must be ${MAX_PROFILE_EMAIL} characters or fewer.` }
  }
  if (contactEmail.length > 0 && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(contactEmail)) {
    return { valid: false, message: 'Enter an email address like name@school.edu.' }
  }
  if (bio.length > MAX_PROFILE_BIO) {
    return { valid: false, message: `About must be ${MAX_PROFILE_BIO} characters or fewer.` }
  }
  if (/[<>]/.test(bio) || /[<>]/.test(displayName)) {
    return { valid: false, message: 'Angle brackets are not allowed.' }
  }

  return { valid: true, input: { displayName, phone, contactEmail, bio } }
}

/**
 * The fields a save actually writes.
 *
 * An emptied field is removed rather than stored as `''`, so "never said" and
 * "cleared" end up the same shape — the interface has one absent case to render
 * instead of two. Only these keys and `updated_at` are ever sent, which is what
 * Security Rules require of a member editing themselves.
 */
export function profileFields(input: MemberProfileInput): Record<string, string> {
  const fields: Record<string, string> = {}
  if (input.displayName.trim().length > 0) fields.profile_display_name = input.displayName.trim()
  if (input.phone.trim().length > 0) fields.profile_phone = input.phone.trim()
  if (input.contactEmail.trim().length > 0) {
    fields.profile_contact_email = input.contactEmail.trim()
  }
  if (input.bio.trim().length > 0) fields.profile_bio = input.bio.trim()
  return fields
}

/** The keys a member may touch on their own membership, and nothing else. */
export const PROFILE_FIELD_KEYS = [
  'profile_display_name', 'profile_phone', 'profile_contact_email', 'profile_bio',
] as const

/** Team names for one member, in the organization's own order. */
export function teamNamesOf(
  membership: Pick<OrganizationMembership, 'team_ids'>,
  teams: readonly TheaterTeam[],
): string[] {
  return teams
    .filter((team) => membership.team_ids.includes(team.team_id))
    .map((team) => team.name)
}
