import heroDashboard from './media/hero-dashboard.webp'
import showcaseWorkspace from './media/showcase-workspace.webp'
import showcaseInventory from './media/showcase-inventory.webp'
import showcaseMaintenance from './media/showcase-maintenance.webp'
import showcaseProductions from './media/showcase-productions.webp'
import showcaseAi from './media/showcase-ai.webp'
import workflowCreateJoin from './media/workflow-create-join.webp'
import workflowPermissions from './media/workflow-permissions.webp'
import workflowInventory from './media/workflow-inventory.webp'
import workflowActions from './media/workflow-actions.webp'
import storyBackstage1 from './media/story-backstage1.webp'
import storyBackstage2 from './media/story-backstage2.webp'
import storyBackstage3 from './media/story-backstage3.webp'
import production01 from './media/production-01.webp'
import production02 from './media/production-02.webp'
import production03 from './media/production-03.webp'
import production04 from './media/production-04.webp'
import production05 from './media/production-05.webp'

/**
 * Every image the landing page holds, in one place.
 *
 * The frames declare the aspect ratio they hold open, so an image still on its
 * way moves nothing around it, and `src` is optional throughout: a frame whose
 * asset is missing draws the placeholder rather than collapsing. Every path is
 * an import from this directory — the landing page never loads a remote image,
 * and no component elsewhere imports a file from `media/`.
 *
 * The supplied photographs were re-encoded before they were committed. They
 * arrived as PNG and JPEG carrying camera EXIF, and three of them carried the
 * name of a real school and its GPS coordinates; two were stored rotated. What
 * is here is WebP with the metadata stripped and the rotation baked in.
 */

export interface LandingMedia {
  /** Stable key, used for React lists and for finding the entry again. */
  readonly id: string
  /** The short uppercase caption drawn on the placeholder. */
  readonly label: string
  /** What the image shows, or what a missing one should show. */
  readonly description: string
  /** CSS `aspect-ratio` for the frame, so the layout does not move when the real image arrives. */
  readonly aspect: string
  /**
   * Alt text for the image.
   *
   * The film strip at the foot of the page renders its photographs decoratively
   * with an empty `alt` — the section is labelled and each photograph appears
   * twice for the loop — so for those entries this describes the frame for
   * whoever maintains it rather than for anybody listening.
   */
  readonly alt: string
  /** The imported local image. Absent means "draw the placeholder". */
  readonly src?: string
}

/** The four workflows the product showcase walks through. */
export type FeatureKey = 'inventory' | 'maintenance' | 'productions' | 'ai'

export interface LandingMediaConfig {
  readonly hero: LandingMedia
  readonly storyPhotos: readonly LandingMedia[]
  readonly workspace: LandingMedia
  readonly features: Readonly<Record<FeatureKey, LandingMedia>>
  readonly howItWorks: readonly LandingMedia[]
  readonly productionPhotos: readonly LandingMedia[]
}

export const landingMedia: LandingMediaConfig = {
  /*
   * The hero and the workspace frame are the same screen deliberately shot
   * twice: this is the dashboard as a visitor would meet it, and the workspace
   * frame is the same cards lifted apart. They read as one product without
   * being one picture.
   */
  hero: {
    id: 'hero',
    label: 'App screenshot',
    description: 'The dashboard, whole, as it opens',
    aspect: '16 / 9',
    alt: 'The dashboard, counting inventory records, active repairs, productions and upcoming events.',
    src: heroDashboard,
  },

  /*
   * Three photographs rather than one.
   *
   * The narrative section carries the only part of the page that is not about
   * the software, and one portrait beside three paragraphs left it looking
   * thin. Three read as a contact sheet — and they are deliberately at three
   * different distances: a pair of hands, a load-in, and a whole stage mid-build.
   */
  storyPhotos: [
    {
      id: 'story-01',
      label: 'Build detail',
      description: 'Sanding and clamping a flat, close in',
      aspect: '4 / 3',
      alt: 'Two students clamping and sanding a set flat.',
      src: storyBackstage1,
    },
    {
      id: 'story-02',
      label: 'Load-in',
      description: 'Set pieces going onto the truck',
      aspect: '4 / 3',
      alt: 'Flats and platforms stacked on a truck during a load-in.',
      src: storyBackstage2,
    },
    {
      id: 'story-03',
      label: 'Build day',
      description: 'The stage mid-build, tools laid out',
      aspect: '4 / 3',
      alt: 'A stage during a build day, with tools and hardware laid out on a table.',
      src: storyBackstage3,
    },
  ],

  workspace: {
    id: 'workspace',
    label: 'Dashboard screenshot',
    description: 'The dashboard cards, lifted apart',
    aspect: '16 / 9',
    alt: 'Dashboard cards showing equipment status, inventory by category, and open needs.',
    src: showcaseWorkspace,
  },

  features: {
    inventory: {
      id: 'feature-inventory',
      label: 'Inventory screenshot',
      description: 'The inventory list, with availability and condition',
      aspect: '16 / 9',
      alt: 'The inventory list, showing each item with its available quantity, condition and location.',
      src: showcaseInventory,
    },
    maintenance: {
      id: 'feature-maintenance',
      label: 'Maintenance screenshot',
      description: 'The repair list, with what is out and what is overdue',
      aspect: '16 / 9',
      alt: 'The maintenance list, showing what was sent for repair, when it is expected back, and what is overdue.',
      src: showcaseMaintenance,
    },
    productions: {
      id: 'feature-productions',
      label: 'Production detail screenshot',
      description: 'A production, its requirements and its shortages',
      aspect: '16 / 9',
      alt: 'A production detail page listing requirements matched against inventory, with shortages and estimated cost.',
      src: showcaseProductions,
    },
    ai: {
      id: 'feature-ai',
      label: 'AI smart search screenshot',
      description: 'Smart Search answering, with the records it read',
      aspect: '16 / 9',
      alt: 'AI Smart Search answering a plain-language question, listing the equipment records behind the answer.',
      src: showcaseAi,
    },
  },

  /*
   * The workflow frames are the act of using a screen where the showcase frames
   * are the screen itself: the item form rather than the inventory list, the
   * action rather than the shortage.
   */
  howItWorks: [
    {
      id: 'step-organization',
      label: 'Organization screenshot',
      description: 'Creating an organization, or joining with a code',
      aspect: '16 / 9',
      alt: 'The create-or-join screen, with a dialog asking for an organization code.',
      src: workflowCreateJoin,
    },
    {
      id: 'step-assignment',
      label: 'Permissions screenshot',
      description: 'The assignment dialog, teams and module access',
      aspect: '16 / 9',
      alt: 'The member assignment dialog, with crews to pick from and a permission level for each module.',
      src: workflowPermissions,
    },
    {
      id: 'step-records',
      label: 'Item form screenshot',
      description: 'The item form, generating a run of numbered units',
      aspect: '16 / 9',
      alt: 'The inventory item form, with a dialog generating a numbered run of individual units.',
      src: workflowInventory,
    },
    {
      id: 'step-production',
      label: 'Requirements screenshot',
      description: 'Adding a requirement, and planning the action it needs',
      aspect: '16 / 9',
      alt: 'A requirement being added to a production, alongside the action planned to cover its shortage.',
      src: workflowActions,
    },
  ],

  /*
   * The film strip at the foot of the page.
   *
   * Five photographs across eight frames. Two of the six supplied were the same
   * file, so the set is ordered rather than repeated in place: no photograph
   * touches itself, including across the wrap, and the second row starts a
   * different distance in so the two rows never line up. Mixed aspect ratios on
   * purpose — a row of identical rectangles reads as a component, a row of
   * different ones reads as a contact sheet.
   */
  productionPhotos: [
    {
      id: 'production-01', label: 'Project photo 01', description: 'The company on the set, after a build',
      aspect: '3 / 2', alt: 'Cast and crew on stage in front of a finished set.', src: production01,
    },
    {
      id: 'production-02', label: 'Project photo 02', description: 'Flats stacked over the auditorium seats',
      aspect: '16 / 9', alt: 'Set flats stored above the auditorium seating.', src: production02,
    },
    {
      id: 'production-03', label: 'Project photo 03', description: 'A set piece in the scene shop',
      aspect: '16 / 9', alt: 'Two crew members beside a set piece in the scene shop.', src: production03,
    },
    {
      id: 'production-04', label: 'Project photo 04', description: 'Backstage, between jobs',
      aspect: '3 / 2', alt: 'Two crew members talking backstage beside a part-built flat.', src: production04,
    },
    {
      id: 'production-05', label: 'Project photo 05', description: 'Rigging and cable in the shop',
      aspect: '3 / 4', alt: 'Crew working on rigging equipment in the shop.', src: production05,
    },
    {
      id: 'production-06', label: 'Project photo 06', description: 'The company on the set, after a build',
      aspect: '3 / 2', alt: 'Cast and crew on stage in front of a finished set.', src: production01,
    },
    {
      id: 'production-07', label: 'Project photo 07', description: 'Rigging and cable in the shop',
      aspect: '3 / 4', alt: 'Crew working on rigging equipment in the shop.', src: production05,
    },
    {
      id: 'production-08', label: 'Project photo 08', description: 'A set piece in the scene shop',
      aspect: '16 / 9', alt: 'Two crew members beside a set piece in the scene shop.', src: production03,
    },
  ],
}
