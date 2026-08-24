import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')

/** `@/x/y` becomes `<root>/src/x/y`, with the extension Node needs appended. */
export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context)

  const base = join(projectRoot, 'src', specifier.slice(2))
  const candidate = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]
    .find((path) => existsSync(path) && !path.endsWith('/'))

  if (!candidate) {
    throw new Error(`Cannot resolve "${specifier}" under ${join(projectRoot, 'src')}`)
  }

  return { url: pathToFileURL(candidate).href, shortCircuit: true }
}
