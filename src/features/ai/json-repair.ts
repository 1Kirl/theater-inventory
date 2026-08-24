/**
 * Reading a response that the model did not finish writing.
 *
 * When generation stops at `maxOutputTokens` the SDK returns the partial text
 * rather than an error, so a long answer arrives as JSON cut off mid-value.
 * Discarding all of it throws away work that is complete and correct up to the
 * cut.
 *
 * This closes a truncated document at the last point where its structure was
 * still whole. It repairs *structure* only — no key is invented and no value is
 * completed — and everything it produces is validated afterwards like any other
 * response.
 */

interface Scan {
  /** Index just past the last point where a value had finished. */
  end: number
  /** Containers still open at that point, outermost first. */
  open: string[]
}

function scan(text: string): Scan {
  const stack: string[] = []
  let inString = false
  let escaped = false
  let end = -1
  let open: string[] = []

  function mark(index: number) {
    end = index
    open = [...stack]
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }

    if (char === '}' || char === ']') {
      stack.pop()
      // A container just finished. Everything up to here is a whole value,
      // whatever depth it sat at.
      if (stack.length > 0) mark(index + 1)
      continue
    }

    // A comma means the value before it finished, which covers scalar entries
    // that never opened a container of their own. Cutting at the comma leaves
    // no trailing one behind.
    if (char === ',' && stack.length > 0) mark(index)
  }

  return { end, open }
}

/**
 * Return parseable JSON text, repairing a truncated tail when it is safe to.
 *
 * Returns null when there is nothing complete to keep.
 */
export function repairTruncatedJson(raw: string): string | null {
  const text = raw.trim()
  if (text.length === 0) return null

  // An intact response needs nothing done to it.
  try {
    JSON.parse(text)
    return text
  } catch {
    // Fall through to the repair.
  }

  const { end, open } = scan(text)
  if (end <= 0) return null

  const closers = open
    .slice()
    .reverse()
    .map((opener) => (opener === '{' ? '}' : ']'))
    .join('')

  const repaired = text.slice(0, end) + closers

  try {
    JSON.parse(repaired)
    return repaired
  } catch {
    return null
  }
}
