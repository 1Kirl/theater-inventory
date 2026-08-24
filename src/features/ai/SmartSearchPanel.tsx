import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { aiFailureMessage } from '@/features/ai/ai-errors'
import { reportAiFailure } from '@/features/ai/ai-diagnostics'
import type { SmartSearchResult } from '@/features/ai/smart-search'
import { MAX_QUERY_LENGTH, askInventoryQuestion } from '@/features/ai/smart-search-service'
import type { InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

/**
 * Smart Search sits above the manual filters, never in place of them.
 *
 * The model is given the records the user may already read and answers the
 * question from them, so what appears here is a sentence about their actual
 * equipment followed by the actual records it refers to. If this fails, or the
 * AI is unavailable entirely, the inventory page behaves exactly as it did
 * before Phase 7.
 */

const EXAMPLES = [
  'find equipment with no inspection history',
  'show me anything that may need attention',
  'do we have enough microphones for 20 performers?',
]

interface Props {
  items: readonly InventoryItem[]
  teams: readonly TheaterTeam[]
  /** Delivered to the page, which shows the real records the answer names. */
  onAnswer: (result: SmartSearchResult) => void
  onClear: () => void
  active: SmartSearchResult | null
}

export function SmartSearchPanel({ items, teams, onAnswer, onClear, active }: Props) {
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask(text: string) {
    const trimmed = text.trim()
    if (running || trimmed.length === 0) return

    setRunning(true)
    setError(null)

    try {
      const result = await askInventoryQuestion({ query: trimmed, items, teams })
      setAsked(trimmed)
      onAnswer(result)
    } catch (caught) {
      // The message on screen stays deliberately vague; the console gets the
      // sanitized detail, in development only.
      reportAiFailure(caught, 'smart-search')
      setError(aiFailureMessage(caught))
    } finally {
      setRunning(false)
    }
  }

  function clear() {
    setQuery('')
    setAsked(null)
    setError(null)
    onClear()
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2">
          <Sparkles className="text-muted-foreground size-4" aria-hidden="true" />
          <p className="text-sm font-medium">Ask about your inventory</p>
        </div>

        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void ask(query)
          }}
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. what lighting equipment hasn't been inspected?"
            maxLength={MAX_QUERY_LENGTH}
            disabled={running}
            aria-label="Ask a question about the inventory"
          />
          <Button type="submit" disabled={running || query.trim().length === 0} className="sm:w-auto">
            {running ? 'Looking…' : 'Ask'}
          </Button>
        </form>

        {/* Stacked on a phone, chips on a wider screen. The button base sets
            `whitespace-nowrap` and `shrink-0`, which together make a long
            example one unbreakable line wider than the card, so both are
            overridden below rather than the examples being shortened. */}
        {!active && !running ? (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
            {EXAMPLES.map((example) => (
              <Button
                key={example}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-7 w-full shrink justify-start py-1.5 text-left text-xs leading-snug break-words whitespace-normal sm:w-auto"
                onClick={() => {
                  setQuery(example)
                  void ask(example)
                }}
              >
                {example}
              </Button>
            ))}
          </div>
        ) : null}

        {running ? (
          <p className="text-muted-foreground text-sm">
            Reading {items.length} inventory record{items.length === 1 ? '' : 's'}…
          </p>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="space-y-2">
              <span className="block">{error}</span>
              <span className="text-xs">The search and filters below keep working without AI.</span>
            </AlertDescription>
          </Alert>
        ) : null}

        {active ? (
          <div className="space-y-3">
            {asked ? (
              <p className="text-muted-foreground text-xs">You asked: {asked}</p>
            ) : null}

            <div className="bg-muted/50 space-y-2 rounded-md p-3">
              <p className="text-sm whitespace-pre-wrap">{active.answer}</p>
              <p className="text-muted-foreground text-xs">
                {active.items.length === 0
                  ? 'No records were named. The list below is unfiltered.'
                  : `Showing the ${active.items.length} record${active.items.length === 1 ? '' : 's'} this answer refers to, read from Firestore.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {active.resolved?.summary.map((entry) => (
                <Badge key={entry} variant="secondary">{entry}</Badge>
              ))}
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clear}>
                <X className="size-3" aria-hidden="true" />
                Clear AI answer
              </Button>
            </div>

            {active.omittedCount > 0 ? (
              <p className="text-muted-foreground text-xs">
                {active.omittedCount} record{active.omittedCount === 1 ? '' : 's'} did not fit in
                this request, so the answer may not cover everything. Narrow the question, or use
                the filters below.
              </p>
            ) : null}

            {active.unknownRefs.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                The AI referred to {active.unknownRefs.length} item
                {active.unknownRefs.length === 1 ? '' : 's'} that were not in its list. Those were
                discarded rather than shown.
              </p>
            ) : null}

            {active.resolved && active.resolved.notes.length > 0
              ? active.resolved.notes.map((note) => (
                <p key={note} className="text-muted-foreground text-xs">{note}</p>
              ))
              : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
