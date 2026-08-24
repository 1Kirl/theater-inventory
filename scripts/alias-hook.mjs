/**
 * Lets Node resolve the project's `@/` alias.
 *
 * The seed script reuses the application's own payload builders so seeded
 * documents are byte-identical to ones the app writes. Those modules import
 * through `@/`, which Vite understands and Node does not, so the alias is
 * taught to Node here rather than the shapes being copied into the script.
 *
 * Node 22 strips TypeScript types natively, so nothing needs compiling.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./alias-resolver.mjs', pathToFileURL(import.meta.filename))
