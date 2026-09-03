/**
 * Every image the landing page will eventually hold, in one place.
 *
 * Nothing here is an image yet. Each entry describes a frame — its shape, what
 * belongs in it, and the alt text it will need — and the page renders a styled
 * placeholder until `src` is filled in. That is the whole point of the file:
 * dropping in the real screenshots and production photographs later is an edit
 * to this module, not to any layout.
 *
 * To replace one:
 *
 *   import inventoryShot from './media/inventory.png'
 *   ...
 *   inventory: { ..., src: inventoryShot },
 *
 * Local files only. The landing page never loads a remote image.
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
  /** Alt text for the real image. Written now so it cannot be forgotten later. */
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
    description: 'Replace with the final application screenshot',
    aspect: '16 / 10',
    alt: 'The Theater Inventory Tracker dashboard.',
  },

  story: {
    id: 'story',
    label: 'Project photo',
    description: 'Replace with a real theatre production photo',
    aspect: '4 / 5',
    alt: 'Backstage during a school theatre production.',
  },

  workspace: {
    id: 'workspace',
    label: 'Dashboard screenshot',
    description: 'Replace with the full dashboard screenshot',
    aspect: '16 / 9',
    alt: 'The dashboard, showing inventory, maintenance, production and calendar summaries.',
  },

  features: {
    inventory: {
      id: 'feature-inventory',
      label: 'Inventory screenshot',
      description: 'Replace with the inventory list or item detail screen',
      aspect: '16 / 10',
      alt: 'The inventory list, showing items with their available quantity and condition.',
    },
    maintenance: {
      id: 'feature-maintenance',
      label: 'Maintenance screenshot',
      description: 'Replace with the maintenance list or repair record screen',
      aspect: '16 / 10',
      alt: 'A maintenance record showing what went out for repair and when it is due back.',
    },
    productions: {
      id: 'feature-productions',
      label: 'Production detail screenshot',
      description: 'Replace with the production detail screen showing requirements and shortages',
      aspect: '16 / 10',
      alt: 'A production detail page listing requirements matched against inventory.',
    },
    ai: {
      id: 'feature-ai',
      label: 'AI smart search screenshot',
      description: 'Replace with AI Smart Search or the requirement draft review',
      aspect: '16 / 10',
      alt: 'AI Smart Search answering a plain-language question about the inventory.',
    },
  },

  howItWorks: [
    {
      id: 'step-organization',
      label: 'Organization screenshot',
      description: 'Replace with the create or join organization screen',
      aspect: '16 / 10',
      alt: 'Creating an organization, or joining one with a code.',
    },
    {
      id: 'step-assignment',
      label: 'Permissions screenshot',
      description: 'Replace with the member assignment dialog in Organization Settings',
      aspect: '16 / 10',
      alt: 'Assigning a member to teams and setting their module permissions.',
    },
    {
      id: 'step-records',
      label: 'Item form screenshot',
      description: 'Replace with the inventory item form or the item detail screen',
      aspect: '16 / 10',
      alt: 'Recording an inventory item, its quantity, and its condition.',
    },
    {
      id: 'step-production',
      label: 'Requirements screenshot',
      description: 'Replace with the requirement list or the action list screen',
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
      description: 'Production photo',
      aspect: '3 / 2',
      alt: 'Working backstage during a production.',
    },
    {
      id: 'production-02',
      label: 'Project photo 02',
      description: 'Production photo',
      aspect: '4 / 5',
      alt: 'Preparing equipment before a performance.',
    },
    {
      id: 'production-03',
      label: 'Project photo 03',
      description: 'Production photo',
      aspect: '16 / 9',
      alt: 'The lighting position during a rehearsal.',
    },
    {
      id: 'production-04',
      label: 'Project photo 04',
      description: 'Production photo',
      aspect: '1 / 1',
      alt: 'Equipment laid out in the storage room.',
    },
    {
      id: 'production-05',
      label: 'Project photo 05',
      description: 'Production photo',
      aspect: '5 / 4',
      alt: 'The sound desk during a technical rehearsal.',
    },
    {
      id: 'production-06',
      label: 'Project photo 06',
      description: 'Production photo',
      aspect: '3 / 4',
      alt: 'Checking a microphone before a show.',
    },
    {
      id: 'production-07',
      label: 'Project photo 07',
      description: 'Production photo',
      aspect: '16 / 10',
      alt: 'The stage during a build day.',
    },
    {
      id: 'production-08',
      label: 'Project photo 08',
      description: 'Production photo',
      aspect: '4 / 3',
      alt: 'Crew work in progress before opening night.',
    },
  ],
}
