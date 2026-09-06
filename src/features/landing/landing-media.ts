/**
 * Every image the landing page will eventually hold, in one place.
 *
 * Nineteen frames, all of them still empty. Each entry describes one — its
 * shape, what belongs in it, and the alt text it will need — and the page draws
 * a styled placeholder until `src` is filled in. That is the whole point of the
 * file: adding the real screenshots later is an edit to this module and to
 * nothing else, and a frame whose image has not arrived yet still holds its
 * space rather than collapsing the layout around it.
 *
 * To fill one:
 *
 *   import inventoryShot from './media/inventory.webp'
 *   ...
 *   inventory: { ..., src: inventoryShot },
 *
 * Two things are worth knowing before shooting them.
 *
 * The hero and the workspace frame are the same screen, so they must not be the
 * same picture — the hero wants the whole dashboard, the workspace frame wants a
 * tighter crop of it. And the four workflow frames are deliberately not the four
 * product frames: the showcase shows what a screen holds, the workflow shows the
 * act of using it, so where the showcase has the inventory list the workflow has
 * the item form.
 *
 * Local files only. The landing page never loads a remote image. Everything
 * below the hero is lazy; the hero alone is fetched eagerly, because it is the
 * largest thing above the fold and lazy-loading it would make the page wait on
 * its own first impression.
 */

export interface LandingMedia {
  /** Stable key, used for React lists and for finding the entry again. */
  readonly id: string
  /** The short uppercase caption drawn on the placeholder. */
  readonly label: string
  /** What the finished image should actually show. Shown on the placeholder. */
  readonly description: string
  /** CSS `aspect-ratio` for the frame, so the layout does not move when the real image arrives. */
  readonly aspect: string
  /**
   * Alt text for the real image, written now so it cannot be forgotten later.
   *
   * The film strip at the foot of the page renders its photographs decoratively
   * with an empty `alt` — the section is labelled, and each photograph appears
   * twice for the loop. For those entries this stays as the note on what to
   * photograph rather than as text anybody hears.
   */
  readonly alt: string
  /** The imported local image, once there is one. Absent means "draw the placeholder". */
  readonly src?: string
}

/** The four workflows the feature showcase walks through. */
export type FeatureKey = 'inventory' | 'maintenance' | 'productions' | 'ai'

export interface LandingMediaConfig {
  readonly hero: LandingMedia
  readonly story: LandingMedia
  readonly workspace: LandingMedia
  readonly features: Readonly<Record<FeatureKey, LandingMedia>>
  readonly howItWorks: readonly LandingMedia[]
  readonly productionPhotos: readonly LandingMedia[]
}

export const landingMedia: LandingMediaConfig = {
  hero: {
    id: 'hero',
    label: 'App screenshot',
    description: 'Dashboard, full width, showing every summary card at once',
    aspect: '16 / 10',
    alt: 'The Theater Inventory Tracker dashboard.',
  },

  story: {
    id: 'story',
    label: 'Project photo',
    description: 'A real photograph from a production. Portrait, backstage rather than on stage',
    aspect: '4 / 5',
    alt: 'Backstage during a school theatre production.',
  },

  workspace: {
    id: 'workspace',
    label: 'Dashboard screenshot',
    description: 'Dashboard again, cropped tighter than the hero so the two differ',
    aspect: '16 / 9',
    alt: 'The dashboard, showing inventory, maintenance, production and calendar summaries.',
  },

  features: {
    inventory: {
      id: 'feature-inventory',
      label: 'Inventory screenshot',
      description: 'Inventory list, with the availability and condition columns visible',
      aspect: '16 / 10',
      alt: 'The inventory list, showing items with their available quantity and condition.',
    },
    maintenance: {
      id: 'feature-maintenance',
      label: 'Maintenance screenshot',
      description: 'One maintenance record, open, showing its due date and cost',
      aspect: '16 / 10',
      alt: 'A maintenance record showing what went out for repair and when it is due back.',
    },
    productions: {
      id: 'feature-productions',
      label: 'Production detail screenshot',
      description: 'A production detail page with at least one requirement showing a shortage',
      aspect: '16 / 10',
      alt: 'A production detail page listing requirements matched against inventory.',
    },
    ai: {
      id: 'feature-ai',
      label: 'AI smart search screenshot',
      description: 'Smart Search mid-answer, with the matched records listed beneath it',
      aspect: '16 / 10',
      alt: 'AI Smart Search answering a plain-language question about the inventory.',
    },
  },

  howItWorks: [
    {
      id: 'step-organization',
      label: 'Organization screenshot',
      description: 'The create-or-join screen. Blank the join code before shooting',
      aspect: '16 / 10',
      alt: 'Creating an organization, or joining one with a code.',
    },
    {
      id: 'step-assignment',
      label: 'Permissions screenshot',
      description: 'The member assignment dialog, teams and module permissions both visible',
      aspect: '16 / 10',
      alt: 'Assigning a member to teams and setting their module permissions.',
    },
    {
      id: 'step-records',
      label: 'Item form screenshot',
      description: 'The item form being filled in — the form, not the list the showcase uses',
      aspect: '16 / 10',
      alt: 'Recording an inventory item, its quantity, and its condition.',
    },
    {
      id: 'step-production',
      label: 'Requirements screenshot',
      description: 'The action list — the work a shortage became, not the shortage itself',
      aspect: '16 / 10',
      alt: 'A production requirement showing the shortage calculated from live availability.',
    },
  ],

  /*
   * The film-strip gallery at the foot of the page.
   *
   * Deliberately mixed aspect ratios: a row of identical rectangles reads as a
   * component, and a row of different ones reads as a contact sheet. Replace
   * `src` one at a time; the strip does not care how many entries it has, and
   * duplicates itself to make the loop seamless.
   */
  productionPhotos: [
    {
      id: 'production-01',
      label: 'Project photo 01',
      description: 'Landscape. Crew working backstage during a run',
      aspect: '3 / 2',
      alt: 'Working backstage during a production.',
    },
    {
      id: 'production-02',
      label: 'Project photo 02',
      description: 'Portrait. Equipment being prepared before a performance',
      aspect: '4 / 5',
      alt: 'Preparing equipment before a performance.',
    },
    {
      id: 'production-03',
      label: 'Project photo 03',
      description: 'Wide. The lighting position during a rehearsal',
      aspect: '16 / 9',
      alt: 'The lighting position during a rehearsal.',
    },
    {
      id: 'production-04',
      label: 'Project photo 04',
      description: 'Square. Equipment laid out in the storage room',
      aspect: '1 / 1',
      alt: 'Equipment laid out in the storage room.',
    },
    {
      id: 'production-05',
      label: 'Project photo 05',
      description: 'Landscape. The sound desk during a technical rehearsal',
      aspect: '5 / 4',
      alt: 'The sound desk during a technical rehearsal.',
    },
    {
      id: 'production-06',
      label: 'Project photo 06',
      description: 'Portrait. A microphone being checked before a show',
      aspect: '3 / 4',
      alt: 'Checking a microphone before a show.',
    },
    {
      id: 'production-07',
      label: 'Project photo 07',
      description: 'Wide. The stage mid-build',
      aspect: '16 / 10',
      alt: 'The stage during a build day.',
    },
    {
      id: 'production-08',
      label: 'Project photo 08',
      description: 'Landscape. Crew work in progress before opening night',
      aspect: '4 / 3',
      alt: 'Crew work in progress before opening night.',
    },
  ],
}
