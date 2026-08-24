/**
 * Guards applied to every model response before it becomes application state.
 *
 * The contracts return names and keywords; a Firestore document ID coming back
 * would be a fabricated reference that could point outside the active
 * organization. Nothing in the schemas admits one, and this catches an ID that
 * arrives inside a field that is legitimately free text.
 */

/** Firestore auto-IDs are exactly 20 characters of mixed letters and digits. */
export function looksLikeDocumentId(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length !== 20 || !/^[A-Za-z0-9]{20}$/.test(trimmed)) return false

  // A real English phrase of exactly 20 characters has no digits and no
  // internal capitals; requiring both keeps "Miscellaneous Techn" safe.
  return /[0-9]/.test(trimmed) && /[a-z]/.test(trimmed) && /[A-Z0-9]/.test(trimmed)
}

/** Normalized form used for every name comparison the application makes. */
export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
