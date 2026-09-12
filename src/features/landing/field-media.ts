/**
 * Photographs for `05 / In the Field`, found rather than listed.
 *
 * RESERVED FILENAMES — drop any of these into `src/features/landing/media/`
 * and rebuild; nothing else needs editing:
 *
 *   field-01.webp … field-05.webp   on-site photographs, shown in number order
 *   field-logo.webp                 the school's logo, shown small beside the heading
 *
 * Any subset works. One photograph gets a single large frame; two share a row;
 * three, four and five each get a composition of their own (see `landing.css`,
 * "in the field"). Numbers need not be contiguous — `field-01` and `field-04`
 * alone render as two. Anything beyond `field-05`, or named differently, is
 * ignored rather than squeezed in. With no photographs at all the section is
 * text only, and it was written to stand that way.
 *
 * Why a glob and not imports: a static `import` of a file that does not exist
 * yet fails the build. `import.meta.glob` is resolved by Vite at build time and
 * simply returns fewer entries when fewer files exist, so the page can ship
 * before the photographs do and pick them up on the next deploy.
 */

export const MAX_FIELD_PHOTOS = 5

export interface FieldPhoto {
  /** 1 to 5, from the filename. */
  readonly number: number
  readonly src: string
}

export interface FieldMedia {
  readonly photos: readonly FieldPhoto[]
  readonly logo: string | null
}

const PHOTO_NAME = /(?:^|\/)field-0([1-5])\.webp$/
const LOGO_NAME = /(?:^|\/)field-logo\.webp$/

/**
 * Sort and filter whatever the glob found.
 *
 * Pure, and taking the module map as an argument, so the zero/one/many cases
 * can be checked without the files existing.
 */
export function fieldMediaFrom(modules: Readonly<Record<string, string>>): FieldMedia {
  const photos: FieldPhoto[] = []
  let logo: string | null = null

  for (const [path, src] of Object.entries(modules)) {
    if (typeof src !== 'string' || src.length === 0) continue

    const photo = PHOTO_NAME.exec(path)
    if (photo?.[1]) {
      photos.push({ number: Number(photo[1]), src })
      continue
    }
    if (LOGO_NAME.test(path)) logo = src
  }

  photos.sort((a, b) => a.number - b.number)
  return { photos: photos.slice(0, MAX_FIELD_PHOTOS), logo }
}

/** Which composition a given number of photographs gets. */
export type FieldLayout = 'none' | 'single' | 'pair' | 'trio' | 'quad' | 'five'

export function fieldLayoutFor(count: number): FieldLayout {
  const layouts: readonly FieldLayout[] = ['none', 'single', 'pair', 'trio', 'quad', 'five']
  return layouts[Math.max(0, Math.min(count, MAX_FIELD_PHOTOS))] ?? 'none'
}

/*
 * Two patterns rather than one broad one, so a stray file in the directory is
 * never even bundled. `eager` with `import: 'default'` yields the hashed URL of
 * each asset, exactly as a static import of it would.
 */
export const fieldMedia: FieldMedia = fieldMediaFrom({
  ...import.meta.glob<string>('./media/field-0[1-5].webp', { eager: true, import: 'default' }),
  ...import.meta.glob<string>('./media/field-logo.webp', { eager: true, import: 'default' }),
})
