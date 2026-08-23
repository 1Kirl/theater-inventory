/**
 * Organization join codes.
 *
 * Without a server to validate codes, the joining client reads the code
 * document directly, which makes the code a bearer secret. It is sized
 * accordingly: 16 characters from a 32-character alphabet is 2^80.
 */

/** No I, O, 0, or 1 — a code has to survive being read aloud or copied by hand. */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const JOIN_CODE_LENGTH = 16
const JOIN_CODE_GROUP_SIZE = 4

/** Mirrors the shape check Security Rules apply before using a code as a path segment. */
const JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{16}$/

export type RandomBytes = (length: number) => Uint8Array

function cryptoRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Generate a join code.
 *
 * The alphabet has 32 entries and 256 is an exact multiple of 32, so taking a
 * byte modulo 32 is uniform and needs no rejection sampling.
 *
 * `Math.random()` is never used here: it is not a cryptographic source, and a
 * predictable code is a way into an organization.
 */
export function generateJoinCode(randomBytes: RandomBytes = cryptoRandomBytes): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH)

  if (bytes.length !== JOIN_CODE_LENGTH) {
    throw new Error(`Expected ${JOIN_CODE_LENGTH} random bytes, received ${bytes.length}.`)
  }

  let code = ''
  for (const byte of bytes) {
    code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length]
  }

  return code
}

/**
 * Normalize user input into the canonical form used as the document ID.
 * People retype codes with the display grouping, in lower case, or with stray
 * spaces; all of those must resolve to the same document.
 */
export function normalizeJoinCode(rawCode: string): string {
  return rawCode.replace(/[\s-]/g, '').trim().toUpperCase()
}

export function isValidJoinCode(normalizedCode: string): boolean {
  return JOIN_CODE_PATTERN.test(normalizedCode)
}

/** Group for display only. The document ID never contains hyphens. */
export function formatJoinCode(normalizedCode: string): string {
  const groups: string[] = []
  for (let index = 0; index < normalizedCode.length; index += JOIN_CODE_GROUP_SIZE) {
    groups.push(normalizedCode.slice(index, index + JOIN_CODE_GROUP_SIZE))
  }
  return groups.join('-')
}
